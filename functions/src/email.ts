import fetch from 'node-fetch';
import { getSecret, SECRET_NAMES } from './secrets';
import { getParameter, PARAMETER_NAMES } from './params';
import { DraftDocument } from '@natsatopics/shared';

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
    html: `
      <p>Päivän uutispohjainen aihe (pilari: ${draft.pillar}):</p>
      ${sourceNewsHtml}
      ${optionsPreview}
      <p><a href="${baseLink}">Avaa muokkaustyökalu ja julkaise →</a></p>
      <p>Linkki vanhenee 48 tunnin kuluttua.</p>
    `,
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
  const [fromEmail, editorEmail] = await Promise.all([
    getParameter(PARAMETER_NAMES.SENDGRID_FROM_EMAIL),
    getParameter(PARAMETER_NAMES.EDITOR_EMAIL),
  ]);

  await sendViaSendGrid({
    to: editorEmail,
    from: fromEmail,
    fromName: 'Natsastore sisältöpipeline',
    subject: `Natsastore Threads token refresh [${status}]`,
    html: `<p>${escapeHtml(details)}</p>`,
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
