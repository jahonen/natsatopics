import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();
const cache = new Map<string, string>();

/**
 * Reads the latest version of a secret from Google Secret Manager. All
 * third-party credentials (SendGrid, editor email, and each social
 * platform's API keys) live here rather than in code or firebase config, as
 * required by the project brief. Results are cached per warm function
 * instance to avoid redundant API calls.
 */
export async function getSecret(name: string): Promise<string> {
  if (cache.has(name)) return cache.get(name) as string;

  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  if (!projectId) throw new Error('GCLOUD_PROJECT is not set in the function environment');

  const [version] = await client.accessSecretVersion({
    name: `projects/${projectId}/secrets/${name}/versions/latest`,
  });

  const value = version.payload?.data?.toString();
  if (!value) throw new Error(`Secret ${name} has no payload`);

  cache.set(name, value);
  return value;
}

/** Secret Manager names expected to exist for this project. */
export const SECRET_NAMES = {
  EDITOR_EMAIL: 'EDITOR_EMAIL',
  SENDGRID_API_KEY: 'SENDGRID_API_KEY',
  SENDGRID_FROM_EMAIL: 'SENDGRID_FROM_EMAIL',
  WEB_APP_BASE_URL: 'WEB_APP_BASE_URL',
  FACEBOOK_PAGE_ID: 'FACEBOOK_PAGE_ID',
  FACEBOOK_PAGE_ACCESS_TOKEN: 'FACEBOOK_PAGE_ACCESS_TOKEN',
  THREADS_USER_ID: 'THREADS_USER_ID',
  THREADS_ACCESS_TOKEN: 'THREADS_ACCESS_TOKEN',
  BLUESKY_IDENTIFIER: 'BLUESKY_IDENTIFIER',
  BLUESKY_APP_PASSWORD: 'BLUESKY_APP_PASSWORD',
} as const;
