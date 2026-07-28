// Type-only deep import; see EditorPage.tsx for why we avoid the package
// barrel (it re-exports gemini.ts, which is Node-only).
import type { DraftDocument, SocialPlatform } from '@natsatopics/shared/lib/types';

/**
 * Base URL of the `editorApi` Cloud Function (functions/src/index.ts).
 * Set via NEXT_PUBLIC_EDITOR_API_URL in web/.env.local (or App Hosting's
 * apphosting.yaml env section) after `firebase deploy --only functions`
 * prints the function's URL.
 */
const API_BASE = process.env.NEXT_PUBLIC_EDITOR_API_URL ?? '';

export type SafeDraft = Omit<DraftDocument, 'magicToken'>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error ?? `Request failed: ${res.status}`);
  }
  return json as T;
}

export function getDraft(draftId: string, token: string) {
  return request<{ draft: SafeDraft }>(`get-draft?draftId=${encodeURIComponent(draftId)}&token=${encodeURIComponent(token)}`);
}

export function saveDraft(draftId: string, token: string, finalText: string, selectedOptionId?: string) {
  return request<{ ok: true }>('save-draft', {
    method: 'POST',
    body: JSON.stringify({ draftId, token, finalText, selectedOptionId }),
  });
}

export function publishDraft(draftId: string, token: string) {
  return request<{ ok: true; platformPosts: Partial<Record<SocialPlatform, unknown>> }>('publish', {
    method: 'POST',
    body: JSON.stringify({ draftId, token }),
  });
}
