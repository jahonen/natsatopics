import { getFirestore } from 'firebase-admin/firestore';
import { computeWeeklyStats, DraftDocument, isoWeekId, WeeklyAnalyticsStats } from '@natsatopics/shared';
import { sendWeeklyAnalyticsEmail } from './email';

/**
 * Returns the Helsinki calendar date (as a UTC-midnight Date, so plain day
 * arithmetic below is unambiguous) `daysAgo` days before "now".
 */
function helsinkiDateDaysAgo(daysAgo: number): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .split('-')
    .map(Number);
  const today = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  today.setUTCDate(today.getUTCDate() - daysAgo);
  return today;
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Analyses the ISO week that just ended (Monday-Sunday, Europe/Helsinki)
 * against the guide's pillar target shares and the content bank's
 * remaining stock, then emails the editor a summary + recommendations.
 * Deliberately Firestore-only (drafts + contentBank collections) rather
 * than pulling from Cloud Logging/Monitoring, since the functions' runtime
 * service account already has Firestore access for the daily pipeline and
 * editorApi — no new IAM grants needed.
 */
export async function runWeeklyAnalytics(): Promise<WeeklyAnalyticsStats> {
  const db = getFirestore();

  // Runs Monday morning: "yesterday" is last week's Sunday, 6 days before
  // that is last week's Monday.
  const rangeEndDate = helsinkiDateDaysAgo(1);
  const rangeStartDate = helsinkiDateDaysAgo(7);
  const rangeStart = toDateString(rangeStartDate);
  const rangeEnd = toDateString(rangeEndDate);
  const isoWeek = isoWeekId(rangeStartDate);

  const draftsSnap = await db
    .collection('drafts')
    .where('date', '>=', rangeStart)
    .where('date', '<=', rangeEnd)
    .get();
  const drafts = draftsSnap.docs.map((doc) => doc.data() as DraftDocument);

  const [nostalgiaRemaining, historyRemaining] = await Promise.all([
    db.collection('contentBank').where('pillar', '==', 'nostalgia').where('used', '==', false).count().get(),
    db.collection('contentBank').where('pillar', '==', 'history').where('used', '==', false).count().get(),
  ]);

  const stats = computeWeeklyStats(isoWeek, rangeStart, rangeEnd, drafts, {
    nostalgia: nostalgiaRemaining.data().count,
    history: historyRemaining.data().count,
  });

  await sendWeeklyAnalyticsEmail(stats);
  return stats;
}
