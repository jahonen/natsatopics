import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { runDailyPipeline } from './dailyJob';
import { forkAndPublish } from './publish/orchestrator';
import { DraftDocument } from '@natsatopics/shared';

initializeApp();

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? 'natsatopics';
const REGION = 'europe-west1';

function isTokenValid(draft: DraftDocument, token: string): boolean {
  if (draft.magicToken !== token) return false;
  if (new Date(draft.tokenExpiresAt).getTime() < Date.now()) return false;
  return true;
}

function setCors(res: any) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Vaiheet 1-5: runs once per day. Cron in Europe/Helsinki so it lands with
 * the morning news cycle (see luku 1: "tekijä katsoo aamulla uutissyötettä").
 */
export const dailyContentPipeline = onSchedule(
  { schedule: '0 6 * * *', timeZone: 'Europe/Helsinki', region: REGION, timeoutSeconds: 300, memory: '512MiB' },
  async () => {
    const result = await runDailyPipeline(PROJECT_ID);
    if (!result.draftId) {
      console.log(`Daily pipeline produced no draft: ${result.reason}`);
    } else {
      console.log(`Daily pipeline created draft ${result.draftId}`);
    }
  }
);

/**
 * Editor-facing API, called by the web app (App Hosting). All three routes
 * validate the magic-link token server-side on every request; the token
 * itself is never trusted client-side beyond display.
 */
export const editorApi = onRequest({ region: REGION, cors: true }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const db = getFirestore();
  const path = req.path.replace(/^\/+/, '');

  try {
    if (path === 'get-draft' && req.method === 'GET') {
      const { draftId, token } = req.query as { draftId?: string; token?: string };
      if (!draftId || !token) {
        res.status(400).json({ error: 'draftId and token are required' });
        return;
      }
      const snap = await db.collection('drafts').doc(draftId).get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Draft not found' });
        return;
      }
      const draft = snap.data() as DraftDocument;
      if (!isTokenValid(draft, token)) {
        res.status(403).json({ error: 'Invalid or expired token' });
        return;
      }
      const { magicToken, ...safeDraft } = draft;
      res.json({ draft: safeDraft });
      return;
    }

    if (path === 'save-draft' && req.method === 'POST') {
      const { draftId, token, finalText, selectedOptionId } = req.body as {
        draftId?: string;
        token?: string;
        finalText?: string;
        selectedOptionId?: string;
      };
      if (!draftId || !token || !finalText) {
        res.status(400).json({ error: 'draftId, token and finalText are required' });
        return;
      }
      const ref = db.collection('drafts').doc(draftId);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Draft not found' });
        return;
      }
      const draft = snap.data() as DraftDocument;
      if (!isTokenValid(draft, token)) {
        res.status(403).json({ error: 'Invalid or expired token' });
        return;
      }
      if (draft.status !== 'pending_review') {
        res.status(409).json({ error: `Draft is already ${draft.status}` });
        return;
      }
      await ref.update({ finalText, selectedOptionId: selectedOptionId ?? null });
      res.json({ ok: true });
      return;
    }

    if (path === 'publish' && req.method === 'POST') {
      const { draftId, token } = req.body as { draftId?: string; token?: string };
      if (!draftId || !token) {
        res.status(400).json({ error: 'draftId and token are required' });
        return;
      }
      const ref = db.collection('drafts').doc(draftId);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Draft not found' });
        return;
      }
      const draft = snap.data() as DraftDocument;
      if (!isTokenValid(draft, token)) {
        res.status(403).json({ error: 'Invalid or expired token' });
        return;
      }
      if (draft.status !== 'pending_review') {
        res.status(409).json({ error: `Draft is already ${draft.status}` });
        return;
      }
      if (!draft.finalText) {
        res.status(400).json({ error: 'Save a final message before publishing' });
        return;
      }

      // Vaihe 6 & 7 — Julkaisu ja seuranta: fork to each platform pipeline.
      const platformPosts = await forkAndPublish(PROJECT_ID, draft);
      const anyPosted = Object.values(platformPosts).some((p) => p?.status === 'posted');

      await ref.update({
        status: anyPosted ? 'published' : 'rejected',
        platformPosts,
      });

      res.json({ ok: true, platformPosts });
      return;
    }

    res.status(404).json({ error: 'Unknown route' });
  } catch (err: any) {
    console.error('editorApi error', err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});
