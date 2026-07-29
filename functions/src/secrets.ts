import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: string; cachedAt: number }>();

/**
 * Reads the latest version of a secret from Google Secret Manager. All
 * third-party credentials (SendGrid, editor email, and each social
 * platform's API keys) live here rather than in code or firebase config, as
 * required by the project brief. Results are cached per warm function
 * instance (with a short TTL) to avoid redundant API calls while still
 * picking up out-of-band secret rotations within a few minutes, instead of
 * serving a stale value for the lifetime of the instance.
 */
export async function getSecret(name: string): Promise<string> {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.value;

  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  if (!projectId) throw new Error('GCLOUD_PROJECT is not set in the function environment');

  const [version] = await client.accessSecretVersion({
    name: `projects/${projectId}/secrets/${name}/versions/latest`,
  });

  const value = version.payload?.data?.toString();
  if (!value) throw new Error(`Secret ${name} has no payload`);

  cache.set(name, { value, cachedAt: Date.now() });
  return value;
}

/**
 * Adds a new version to an existing Secret Manager secret and refreshes the
 * in-memory cache. Used by scheduled token-refresh jobs (e.g. Threads'
 * long-lived token refresh) that need to rotate a secret's value at
 * runtime rather than via `gcloud` at setup time.
 */
export async function addSecretVersion(name: string, value: string): Promise<void> {
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  if (!projectId) throw new Error('GCLOUD_PROJECT is not set in the function environment');

  await client.addSecretVersion({
    parent: `projects/${projectId}/secrets/${name}`,
    payload: { data: Buffer.from(value, 'utf8') },
  });

  cache.set(name, { value, cachedAt: Date.now() });
}

/** Secret Manager names expected to exist for this project. */
export const SECRET_NAMES = {
  SENDGRID_API_KEY: 'SENDGRID_API_KEY',
  WEB_APP_BASE_URL: 'WEB_APP_BASE_URL',
  FACEBOOK_PAGE_ID: 'FACEBOOK_PAGE_ID',
  FACEBOOK_PAGE_ACCESS_TOKEN: 'FACEBOOK_PAGE_ACCESS_TOKEN',
  THREADS_USER_ID: 'THREADS_USER_ID',
  THREADS_ACCESS_TOKEN: 'THREADS_ACCESS_TOKEN',
  BLUESKY_IDENTIFIER: 'BLUESKY_IDENTIFIER',
  BLUESKY_APP_PASSWORD: 'BLUESKY_APP_PASSWORD',
} as const;
