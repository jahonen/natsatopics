import {
  DraftDocument,
  Pillar,
  PILLAR_TARGET_SHARE,
  PostTemplate,
  SocialPlatform,
  WeeklyAnalyticsStats,
} from './types';

const PILLARS: Pillar[] = ['nostalgia', 'geopolitics', 'reserve', 'history'];
const PLATFORMS: SocialPlatform[] = ['facebook', 'threads', 'bluesky'];

// Below this many remaining prompts, the weekly email should nudge the
// editor to top up the content bank (luku 6: nostalgia/history pillars
// don't come from news, so they run dry if not replenished manually).
const CONTENT_BANK_LOW_THRESHOLD = 5;

// A pillar's actual share more than this far below its target share this
// week is flagged as a recommendation, rather than every tiny deviation
// (a single-digit sample size per week makes small deltas noisy).
const PILLAR_UNDERREPRESENTED_THRESHOLD = 0.1;

function emptyPillarRecord(): Record<Pillar, number> {
  return { nostalgia: 0, geopolitics: 0, reserve: 0, history: 0 };
}

/**
 * Pure function (no Firestore access) that turns a week's worth of drafts
 * plus current content-bank remaining counts into stats + Finnish-language
 * recommendations. Kept separate from the Firestore query (in
 * functions/src/weeklyAnalyticsJob.ts) so the analysis logic itself is
 * unit-testable without an emulator.
 */
export function computeWeeklyStats(
  isoWeek: string,
  rangeStart: string,
  rangeEnd: string,
  drafts: DraftDocument[],
  contentBankRemaining: Record<'nostalgia' | 'history', number>
): WeeklyAnalyticsStats {
  const pillarCounts = emptyPillarRecord();
  const templateCounts: Partial<Record<PostTemplate, number>> = {};
  const platformStats: Record<SocialPlatform, { posted: number; failed: number; adapted: number }> = {
    facebook: { posted: 0, failed: 0, adapted: 0 },
    threads: { posted: 0, failed: 0, adapted: 0 },
    bluesky: { posted: 0, failed: 0, adapted: 0 },
  };

  let publishedCount = 0;
  let rejectedCount = 0;
  let pendingCount = 0;

  for (const draft of drafts) {
    if (draft.status === 'published') {
      publishedCount++;
      pillarCounts[draft.pillar] = (pillarCounts[draft.pillar] ?? 0) + 1;

      const selected = draft.options.find((o) => o.id === draft.selectedOptionId);
      if (selected) {
        templateCounts[selected.template] = (templateCounts[selected.template] ?? 0) + 1;
      }

      for (const platform of PLATFORMS) {
        const result = draft.platformPosts?.[platform];
        if (!result) continue;
        if (result.status === 'posted') {
          platformStats[platform].posted++;
          if (result.text && draft.finalText && result.text !== draft.finalText) {
            platformStats[platform].adapted++;
          }
        } else if (result.status === 'failed') {
          platformStats[platform].failed++;
        }
      }
    } else if (draft.status === 'rejected') {
      rejectedCount++;
    } else {
      pendingCount++;
    }
  }

  const totalPublished = publishedCount || 1; // avoid divide-by-zero in shares below
  const pillarShares = emptyPillarRecord();
  const pillarDeltas = emptyPillarRecord();
  PILLARS.forEach((pillar) => {
    pillarShares[pillar] = pillarCounts[pillar] / totalPublished;
    pillarDeltas[pillar] = pillarShares[pillar] - PILLAR_TARGET_SHARE[pillar];
  });

  const recommendations: string[] = [];

  if (publishedCount === 0) {
    recommendations.push(
      'Viikolla ei julkaistu yhtään postausta — tarkista, että päivittäinen putki ja editorin tarkistus toimivat.'
    );
  } else {
    PILLARS.forEach((pillar) => {
      if (pillarDeltas[pillar] < -PILLAR_UNDERREPRESENTED_THRESHOLD) {
        recommendations.push(
          `Pilari "${pillar}" on alipainottunut tällä viikolla (${Math.round(pillarShares[pillar] * 100)}% vs. tavoite ${Math.round(PILLAR_TARGET_SHARE[pillar] * 100)}%) — suosi sitä ensi viikolla.`
        );
      }
    });
  }

  PLATFORMS.forEach((platform) => {
    const stats = platformStats[platform];
    if (stats.failed > 0) {
      recommendations.push(
        `${stats.failed} julkaisu(a) epäonnistui alustalla "${platform}" tällä viikolla — tarkista tunnistetiedot/API-tila.`
      );
    }
  });

  (['nostalgia', 'history'] as const).forEach((pillar) => {
    if (contentBankRemaining[pillar] <= CONTENT_BANK_LOW_THRESHOLD) {
      recommendations.push(
        `Aihepankissa on jäljellä vain ${contentBankRemaining[pillar]} käyttämätöntä aihetta pilarille "${pillar}" — täydennä pankkia.`
      );
    }
  });

  if (rejectedCount > 0) {
    recommendations.push(
      `${rejectedCount} luonnos hylättiin (ei julkaistu millekään alustalle) tällä viikolla — katso syyt Firestoren "drafts"-kokoelmasta.`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push('Ei erityisiä huomioita — viikko kulki tavoitteiden mukaisesti.');
  }

  return {
    isoWeek,
    rangeStart,
    rangeEnd,
    totalDrafts: drafts.length,
    publishedCount,
    rejectedCount,
    pendingCount,
    pillarCounts,
    pillarShares,
    pillarDeltas,
    templateCounts,
    platformStats,
    contentBankRemaining,
    recommendations,
  };
}
