import { ParameterManagerClient } from '@google-cloud/parametermanager';

const client = new ParameterManagerClient();
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: string; cachedAt: number }>();

/**
 * Reads the latest version of a non-sensitive config value from Google
 * Cloud Parameter Manager. Use this instead of Secret Manager (`secrets.ts`)
 * for values that aren't credentials — e.g. EDITOR_EMAIL — per project
 * convention of keeping true secrets separate from plain configuration.
 * Results are cached per warm function instance with a short TTL, so a
 * rotated value is picked up within a few minutes instead of being served
 * stale for the lifetime of the instance.
 *
 * Unlike Secret Manager, Parameter Manager's `getParameterVersion` does NOT
 * support a `latest` version alias (it 404s) — only `renderParameterVersion`
 * does, so that's the method used here.
 */
export async function getParameter(name: string): Promise<string> {
  const cached = cache.get(name);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.value;

  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  if (!projectId) throw new Error('GCLOUD_PROJECT is not set in the function environment');

  const versionName = client.parameterVersionPath(projectId, 'global', name, 'latest');
  const [response] = await client.renderParameterVersion({ name: versionName });

  const value = response.renderedPayload?.toString();
  if (!value) throw new Error(`Parameter ${name} has no payload`);

  cache.set(name, { value, cachedAt: Date.now() });
  return value;
}

/** Parameter Manager names expected to exist for this project. */
export const PARAMETER_NAMES = {
  EDITOR_EMAIL: 'EDITOR_EMAIL',
  SENDGRID_FROM_EMAIL: 'SENDGRID_FROM_EMAIL',
  // Vertex AI Model Garden model + region used for all AI calls
  // (classification, drafting, platform adaptation). Kept in Parameter
  // Manager rather than hardcoded so the model can be swapped without a
  // code deploy when a provider retires a model.
  AI_MODEL_NAME: 'AI_MODEL_NAME',
  AI_MODEL_LOCATION: 'AI_MODEL_LOCATION',
} as const;

/** Fetches the current AI model config from Parameter Manager. */
export async function getAiModelConfig(): Promise<{ model: string; location: string }> {
  const [model, location] = await Promise.all([
    getParameter(PARAMETER_NAMES.AI_MODEL_NAME),
    getParameter(PARAMETER_NAMES.AI_MODEL_LOCATION),
  ]);
  return { model, location };
}
