import fetch from 'node-fetch';
import { getSecret, SECRET_NAMES } from '../secrets';
import { PlatformPostResult } from '@natsatopics/shared';

export async function publishToFacebook(text: string): Promise<PlatformPostResult> {
  const [pageId, accessToken] = await Promise.all([
    getSecret(SECRET_NAMES.FACEBOOK_PAGE_ID),
    getSecret(SECRET_NAMES.FACEBOOK_PAGE_ACCESS_TOKEN),
  ]);

  const res = await fetch(`https://graph.facebook.com/v20.0/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text, access_token: accessToken }),
  });

  const json = (await res.json()) as { id?: string; error?: { message: string } };
  if (!res.ok || json.error) {
    return { status: 'failed', text, error: json.error?.message ?? `HTTP ${res.status}` };
  }

  return {
    status: 'posted',
    text,
    postId: json.id,
    postUrl: json.id ? `https://www.facebook.com/${json.id}` : undefined,
    postedAt: new Date().toISOString(),
  };
}
