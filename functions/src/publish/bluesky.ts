import fetch from 'node-fetch';
import { getSecret, SECRET_NAMES } from '../secrets';
import { PlatformPostResult } from '@natsatopics/shared';

const DEFAULT_PDS = 'https://bsky.social';

/**
 * Resolves the account's own Personal Data Server (PDS) endpoint, since not
 * every Bluesky account is hosted on bsky.social (e.g. accounts on
 * self-hosted or third-party PDSes like eurosky.social). Falls back to
 * bsky.social if resolution fails for any reason, so a resolver hiccup
 * doesn't fully break publishing for accounts that *are* on bsky.social.
 */
async function resolvePdsEndpoint(identifier: string): Promise<string> {
  try {
    let did = identifier;
    if (!did.startsWith('did:')) {
      const res = await fetch(
        `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(identifier)}`
      );
      const json = (await res.json()) as { did?: string };
      if (!res.ok || !json.did) return DEFAULT_PDS;
      did = json.did;
    }

    if (!did.startsWith('did:plc:')) return DEFAULT_PDS;

    const didDocRes = await fetch(`https://plc.directory/${did}`);
    const didDoc = (await didDocRes.json()) as {
      service?: { id?: string; type?: string; serviceEndpoint?: string }[];
    };
    const pdsService = didDoc.service?.find((s) => s.type === 'AtprotoPersonalDataServer');
    return pdsService?.serviceEndpoint ?? DEFAULT_PDS;
  } catch {
    return DEFAULT_PDS;
  }
}

/** Bluesky uses the AT Protocol; authenticates via app password, then posts a record. */
export async function publishToBluesky(text: string): Promise<PlatformPostResult> {
  const [identifier, appPassword] = await Promise.all([
    getSecret(SECRET_NAMES.BLUESKY_IDENTIFIER),
    getSecret(SECRET_NAMES.BLUESKY_APP_PASSWORD),
  ]);

  try {
    const pds = await resolvePdsEndpoint(identifier);

    const sessionRes = await fetch(`${pds}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: appPassword }),
    });
    const session = (await sessionRes.json()) as { accessJwt?: string; did?: string; message?: string };
    if (!sessionRes.ok || !session.accessJwt || !session.did) {
      return { status: 'failed', text, error: session.message ?? `HTTP ${sessionRes.status}` };
    }

    const postRes = await fetch(`${pds}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record: { text, createdAt: new Date().toISOString(), $type: 'app.bsky.feed.post' },
      }),
    });
    const postJson = (await postRes.json()) as { uri?: string; message?: string };
    if (!postRes.ok || !postJson.uri) {
      return { status: 'failed', text, error: postJson.message ?? `HTTP ${postRes.status}` };
    }

    return { status: 'posted', text, postId: postJson.uri, postedAt: new Date().toISOString() };
  } catch (err: any) {
    return { status: 'failed', text, error: err?.message ?? String(err) };
  }
}
