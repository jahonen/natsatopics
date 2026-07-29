import fetch from 'node-fetch';
import { getSecret, SECRET_NAMES } from './secrets';
import { getParameter, PARAMETER_NAMES } from './params';
import { DraftDocument, Pillar, PILLAR_TARGET_SHARE, SocialPlatform, WeeklyAnalyticsStats } from '@natsatopics/shared';

/** Shared low-level SendGrid HTTP API sender used by every email in this project. */
async function sendViaSendGrid(params: {
  to: string;
  from: string;
  fromName: string;
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = await getSecret(SECRET_NAMES.SENDGRID_API_KEY);

  const body = {
    personalizations: [{ to: [{ email: params.to }] }],
    from: { email: params.from, name: params.fromName },
    subject: params.subject,
    content: [{ type: 'text/html', value: params.html }],
  };

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SendGrid send failed: ${res.status} ${text}`);
  }
}

/**
 * Wraps an email's body HTML in a minimal branded shell: logo (served from
 * the deployed web app's /public folder, see web/public/), Natsastore's
 * brand orange as an accent, and a consistent footer. Kept intentionally
 * simple (table-free, no custom fonts) since this only needs to render
 * correctly in the editor's own inbox, not survive every email client's
 * CSS support like a marketing template would.
 */
function wrapEmailHtml(baseUrl: string, bodyHtml: string): string {
  const logoUrl = `${baseUrl.replace(/\/$/, '')}/android-chrome-192x192.png`;
  return `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; max-width: 640px;">
      <div style="display: flex; align-items: center; gap: 12px; border-bottom: 3px solid #f7941d; padding-bottom: 12px; margin-bottom: 20px;">
        <img src="${logoUrl}" alt="Natsastore" width="48" height="48" style="border-radius: 50%; display: block;">
        <span style="font-size: 20px; font-weight: 700; color: #f7941d;">Natsastore</span>
      </div>
      ${bodyHtml}
      <div style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #888;">
        Natsastore-sisältöpipeline — automaattinen viesti.
      </div>
    </div>`;
}

/**
 * Sends the daily "drafts ready for review" email directly via the SendGrid
 * HTTP API (no Firebase Trigger Email extension), per project decision.
 */
export async function sendMagicLinkEmail(draft: DraftDocument): Promise<void> {
  const [fromEmail, editorEmail, baseUrl] = await Promise.all([
    getParameter(PARAMETER_NAMES.SENDGRID_FROM_EMAIL),
    getParameter(PARAMETER_NAMES.EDITOR_EMAIL),
    getSecret(SECRET_NAMES.WEB_APP_BASE_URL),
  ]);

  const baseLink = `${baseUrl.replace(/\/$/, '')}/editor/${draft.id}?token=${draft.magicToken}`;

  // Each draft option is itself a magic link straight into the editor with
  // that option pre-selected, so the editor can go from "which of these do
  // I like" to "editing it" in one click, instead of always landing on the
  // first option via a single generic link.
  const optionsPreview = draft.options
    .map(
      (o, i) => `
      <p>
        <strong>Vaihtoehto ${i + 1} (${o.template}):</strong><br>
        <a href="${baseLink}&optionId=${encodeURIComponent(o.id)}">${escapeHtml(o.text)}</a>
      </p>`
    )
    .join('\n');

  const sourceNewsHtml = draft.sourceNews
    ? `
      <p>
        <a href="${draft.sourceNews.url}"><strong>${escapeHtml(draft.sourceNews.title)}</strong></a><br>
        ${escapeHtml(draft.sourceNews.summary)}
      </p>`
    : '';

  await sendViaSendGrid({
    to: editorEmail,
    from: fromEmail,
    fromName: 'Natsastore sisältöpipeline',
    subject: `Natsastore: ${draft.date} päivän postausluonnokset odottavat tarkistusta`,
    html: wrapEmailHtml(
      baseUrl,
      `
      <p>Päivän uutispohjainen aihe (pilari: ${draft.pillar}):</p>
      ${sourceNewsHtml}
      ${optionsPreview}
      <p><a href="${baseLink}" style="color: #f7941d; font-weight: 600;">Avaa muokkaustyökalu ja julkaise →</a></p>
      <p>Linkki vanhenee 48 tunnin kuluttua.</p>
    `
    ),
  });
}

/**
 * Notifies the editor by email every time the Threads long-lived token
 * refresh job runs, whether it succeeded or failed, so a silent failure
 * doesn't go unnoticed until the token actually expires and publishing
 * breaks.
 */
export async function sendThreadsRefreshNotification(
  status: 'SUCCESS' | 'FAIL',
  details: string
): Promise<void> {
  const [fromEmail, editorEmail, baseUrl] = await Promise.all([
    getParameter(PARAMETER_NAMES.SENDGRID_FROM_EMAIL),
    getParameter(PARAMETER_NAMES.EDITOR_EMAIL),
    getSecret(SECRET_NAMES.WEB_APP_BASE_URL),
  ]);

  await sendViaSendGrid({
    to: editorEmail,
    from: fromEmail,
    fromName: 'Natsastore sisältöpipeline',
    subject: `Natsastore Threads token refresh [${status}]`,
    html: wrapEmailHtml(baseUrl, `<p>${escapeHtml(details)}</p>`),
  });
}

const PILLAR_LABELS: Record<Pillar, string> = {
  nostalgia: 'Nostalgia',
  geopolitics: 'Geopolitiikka',
  reserve: 'Reservi',
  history: 'Historia',
};

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: 'Facebook',
  threads: 'Threads',
  bluesky: 'Bluesky',
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * Sends the weekly analytics summary (previous ISO week, Monday-Sunday
 * Europe/Helsinki) to the editor: pillar mix vs. the guide's target
 * shares, per-platform publish success/failure, template usage, content
 * bank health, and a Finnish-language recommendations list. See
 * `functions/src/weeklyAnalyticsJob.ts` for how `stats` is computed.
 */
export async function sendWeeklyAnalyticsEmail(stats: WeeklyAnalyticsStats): Promise<void> {
  const [fromEmail, editorEmail, baseUrl] = await Promise.all([
    getParameter(PARAMETER_NAMES.SENDGRID_FROM_EMAIL),
    getParameter(PARAMETER_NAMES.EDITOR_EMAIL),
    getSecret(SECRET_NAMES.WEB_APP_BASE_URL),
  ]);

  const pillarRowsHtml = (Object.keys(PILLAR_TARGET_SHARE) as Pillar[])
    .map((pillar) => {
      const actual = stats.pillarShares[pillar];
      const target = PILLAR_TARGET_SHARE[pillar];
      const overUnder = stats.pillarDeltas[pillar] < 0 ? 'alle tavoitteen' : 'yli/tasan tavoitteen';
      return `
      <tr>
        <td style="padding: 4px 12px 4px 0;">${PILLAR_LABELS[pillar]}</td>
        <td style="padding: 4px 12px 4px 0;">${stats.pillarCounts[pillar]} kpl</td>
        <td style="padding: 4px 12px 4px 0;">${pct(actual)} (tavoite ${pct(target)}, ${overUnder})</td>
      </tr>`;
    })
    .join('\n');

  const platformRowsHtml = (Object.keys(PLATFORM_LABELS) as SocialPlatform[])
    .map((platform) => {
      const s = stats.platformStats[platform];
      return `
      <tr>
        <td style="padding: 4px 12px 4px 0;">${PLATFORM_LABELS[platform]}</td>
        <td style="padding: 4px 12px 4px 0;">${s.posted} julkaistu</td>
        <td style="padding: 4px 12px 4px 0;">${s.failed} epäonnistui</td>
        <td style="padding: 4px 12px 4px 0;">${s.adapted} AI-lyhennettyä</td>
      </tr>`;
    })
    .join('\n');

  const templateRowsHtml = Object.entries(stats.templateCounts)
    .map(([template, count]) => `<li>Malli ${template}: ${count} kpl</li>`)
    .join('\n');

  const recommendationsHtml = stats.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join('\n');

  await sendViaSendGrid({
    to: editorEmail,
    from: fromEmail,
    fromName: 'Natsastore sisältöpipeline',
    subject: `Natsastore: viikon ${stats.isoWeek} analytiikka (${stats.rangeStart}–${stats.rangeEnd})`,
    html: wrapEmailHtml(
      baseUrl,
      `
      <p>Viikko ${stats.isoWeek} (${stats.rangeStart}–${stats.rangeEnd}): ${stats.publishedCount} julkaistu, ${stats.rejectedCount} hylätty, ${stats.pendingCount} yhä käsittelemättä.</p>

      <h3 style="margin-bottom: 4px;">Pilarijakauma vs. tavoite</h3>
      <table>${pillarRowsHtml}</table>

      <h3 style="margin-bottom: 4px;">Alustat</h3>
      <table>${platformRowsHtml}</table>

      ${templateRowsHtml ? `<h3 style="margin-bottom: 4px;">Käytetyt mallipohjat</h3><ul>${templateRowsHtml}</ul>` : ''}

      <h3 style="margin-bottom: 4px;">Suositukset</h3>
      <ul>${recommendationsHtml}</ul>
    `
    ),
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
