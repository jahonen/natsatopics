import fetch from 'node-fetch';
import { addSecretVersion, getSecret, SECRET_NAMES } from '../secrets';

/**
 * Threads long-lived user tokens (obtained via `th_exchange_token`) last 60
 * days and must be refreshed via `th_refresh_token` before they expire —
 * Meta requires the token to be at least 24h old to refresh, and
 * recommends refreshing well ahead of the 60-day expiry. Run on a weekly
 * schedule (see `refreshThreadsToken` in index.ts) so a single missed run
 * still leaves a wide safety margin.
 */
export async function refreshThreadsAccessToken(): Promise<{ expiresInDays: number }> {
  const currentToken = await getSecret(SECRET_NAMES.THREADS_ACCESS_TOKEN);

  const res = await fetch(
    `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(
      currentToken
    )}`
  );
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message: string } };
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(json.error?.message ?? `Threads token refresh failed: HTTP ${res.status}`);
  }

  await addSecretVersion(SECRET_NAMES.THREADS_ACCESS_TOKEN, json.access_token);

  return { expiresInDays: Math.round((json.expires_in ?? 0) / 86400) };
}
