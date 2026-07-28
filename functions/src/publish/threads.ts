import fetch from 'node-fetch';
import { getSecret, SECRET_NAMES } from '../secrets';
import { PlatformPostResult } from '@natsatopics/shared';

/**
 * Threads publishing is a two-step Graph API flow: create a media
 * container, then publish it. https://developers.facebook.com/docs/threads
 */
export async function publishToThreads(text: string): Promise<PlatformPostResult> {
  const [userId, accessToken] = await Promise.all([
    getSecret(SECRET_NAMES.THREADS_USER_ID),
    getSecret(SECRET_NAMES.THREADS_ACCESS_TOKEN),
  ]);

  try {
    const createRes = await fetch(
      `https://graph.threads.net/v1.0/${userId}/threads?media_type=TEXT&text=${encodeURIComponent(
        text
      )}&access_token=${accessToken}`,
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
