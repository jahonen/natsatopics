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
    const createRes = await fetch(
      `https://graph.threads.net/v1.0/${userId}/threads?media_type=TEXT&text=${encodeURIComponent(
        text
      )}${topicTagParam}&access_token=${accessToken}`,
      { method: 'POST' }
    );
    const createJson = (await createRes.json()) as { id?: string; error?: { message: string } };
    if (!createRes.ok || createJson.error || !createJson.id) {
      return { status: 'failed', text, error: createJson.error?.message ?? `HTTP ${createRes.status}` };
    }

    const publishRes = await fetch(
      `https://graph.threads.net/v1.0/${userId}/threads_publish?creation_id=${createJson.id}&access_token=${accessToken}`,
      { method: 'POST' }
    );
    const publishJson = (await publishRes.json()) as { id?: string; error?: { message: string } };
    if (!publishRes.ok || publishJson.error || !publishJson.id) {
      return { status: 'failed', text, error: publishJson.error?.message ?? `HTTP ${publishRes.status}` };
    }

    return { status: 'posted', text, postId: publishJson.id, postedAt: new Date().toISOString() };
  } catch (err: any) {
    return { status: 'failed', text, error: err?.message ?? String(err) };
  }
}
