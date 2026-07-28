import fetch from 'node-fetch';
import { getSecret, SECRET_NAMES } from '../secrets';
import { PlatformPostResult } from '@natsatopics/shared';

/** Bluesky uses the AT Protocol; authenticates via app password, then posts a record. */
export async function publishToBluesky(text: string): Promise<PlatformPostResult> {
  const [identifier, appPassword] = await Promise.all([
    getSecret(SECRET_NAMES.BLUESKY_IDENTIFIER),
    getSecret(SECRET_NAMES.BLUESKY_APP_PASSWORD),
  ]);

  try {
    const sessionRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: appPassword }),
    });
    const session = (await sessionRes.json()) as { accessJwt?: string; did?: string; message?: string };
    if (!sessionRes.ok || !session.accessJwt || !session.did) {
      return { status: 'failed', text, error: session.message ?? `HTTP ${sessionRes.status}` };
    }

    const postRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
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
