import fetch from 'node-fetch';
import { getSecret, SECRET_NAMES } from '../secrets';
import { PlatformPostResult, Pillar } from '@natsatopics/shared';

/**
 * Maps each content pillar (luku 6) to the Threads Community/Topic tag
 * (https://developers.facebook.com/docs/threads/posts/#topic-tags) its
 * posts should carry. Nostalgia and history don't map to a dedicated tag
 * of their own, so they fall back to the general national-defense topic.
 */
const PILLAR_TOPIC_TAGS: Record<Pillar, string> = {
  geopolitics: 'TURPO',
  reserve: 'Reservi',
  nostalgia: 'Maanpuolustus',
  history: 'Maanpuolustus',
};

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = [1000, 3000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Threads' Graph API intermittently returns generic transient errors (e.g.
 * "The requested resource does not exist") for otherwise-valid requests —
 * a known flakiness in the Threads API rather than a credentials/config
 * issue (confirmed by immediately replaying an identical failed request
 * successfully). Retry both steps a couple of times with backoff before
 * giving up.
 */
async function postWithRetry(url: string): Promise<{ id?: string; error?: { message: string } }> {
  let lastResult: { id?: string; error?: { message: string } } = {};
  let lastStatus = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, { method: 'POST' });
    const json = (await res.json()) as { id?: string; error?: { message: string } };
    if (res.ok && !json.error && json.id) return json;
    lastResult = json;
    lastStatus = res.status;
    if (attempt < MAX_ATTEMPTS - 1) await sleep(RETRY_DELAY_MS[attempt]);
  }
  return lastResult.error ? lastResult : { error: { message: `HTTP ${lastStatus}` } };
}

/**
 * Threads publishing is a two-step Graph API flow: create a media
 * container, then publish it. https://developers.facebook.com/docs/threads
 */
export async function publishToThreads(text: string, pillar?: Pillar): Promise<PlatformPostResult> {
  const [userId, accessToken] = await Promise.all([
    getSecret(SECRET_NAMES.THREADS_USER_ID),
    getSecret(SECRET_NAMES.THREADS_ACCESS_TOKEN),
  ]);

  try {
    const topicTag = pillar ? PILLAR_TOPIC_TAGS[pillar] : undefined;
    const topicTagParam = topicTag ? `&topic_tag=${encodeURIComponent(topicTag)}` : '';
    const createJson = await postWithRetry(
      `https://graph.threads.net/v1.0/${userId}/threads?media_type=TEXT&text=${encodeURIComponent(
        text
      )}${topicTagParam}&access_token=${accessToken}`
    );
    if (!createJson.id) {
      return { status: 'failed', text, error: createJson.error?.message ?? 'Threads container creation failed' };
    }

    const publishJson = await postWithRetry(
      `https://graph.threads.net/v1.0/${userId}/threads_publish?creation_id=${createJson.id}&access_token=${accessToken}`
    );
    if (!publishJson.id) {
      return { status: 'failed', text, error: publishJson.error?.message ?? 'Threads publish failed' };
    }

    return { status: 'posted', text, postId: publishJson.id, postedAt: new Date().toISOString() };
  } catch (err: any) {
    return { status: 'failed', text, error: err?.message ?? String(err) };
  }
}
