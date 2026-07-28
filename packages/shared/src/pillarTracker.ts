import type { Firestore } from 'firebase-admin/firestore';
import { Pillar, PILLAR_TARGET_SHARE, WeeklyPillarCounts } from './types';

const COLLECTION = 'weeklyPillarCounts';

/** ISO week identifier, e.g. "2026-W31", in Europe/Helsinki local time. */
export function isoWeekId(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function emptyCounts(): Record<Pillar, number> {
  return { nostalgia: 0, geopolitics: 0, reserve: 0, history: 0 };
}

export async function getWeeklyCounts(db: Firestore, isoWeek: string): Promise<WeeklyPillarCounts> {
  const doc = await db.collection(COLLECTION).doc(isoWeek).get();
  if (!doc.exists) {
    return { isoWeek, counts: emptyCounts() };
  }
  return doc.data() as WeeklyPillarCounts;
}

export async function recordPillarUse(db: Firestore, isoWeek: string, pillar: Pillar): Promise<void> {
  const ref = db.collection(COLLECTION).doc(isoWeek);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current: WeeklyPillarCounts = snap.exists
      ? (snap.data() as WeeklyPillarCounts)
      : { isoWeek, counts: emptyCounts() };
    current.counts[pillar] = (current.counts[pillar] ?? 0) + 1;
    tx.set(ref, current);
  });
}

/**
 * Chooses which pillar today's proposal(s) should target, per Vaihe 3 of the
 * daily process: if the week's distribution is already skewed away from the
 * guide's target shares, prefer the most under-represented pillar over
 * whatever a news-driven proposal would naturally fall into.
 */
export function pickUnderrepresentedPillar(counts: Record<Pillar, number>): Pillar {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  let worstPillar: Pillar = 'nostalgia';
  let worstDelta = -Infinity;
  (Object.keys(PILLAR_TARGET_SHARE) as Pillar[]).forEach((pillar) => {
    const actualShare = (counts[pillar] ?? 0) / total;
    const delta = PILLAR_TARGET_SHARE[pillar] - actualShare;
    if (delta > worstDelta) {
      worstDelta = delta;
      worstPillar = pillar;
    }
  });
  return worstPillar;
}
