import fetch from 'node-fetch';
import { getSecret, SECRET_NAMES } from './secrets';
import { DraftDocument } from '@natsatopics/shared';

/**
 * Sends the daily "drafts ready for review" email directly via the SendGrid
 * HTTP API (no Firebase Trigger Email extension), per project decision.
 */
export async function sendMagicLinkEmail(draft: DraftDocument): Promise<void> {
  const [apiKey, fromEmail, editorEmail, baseUrl] = await Promise.all([
    getSecret(SECRET_NAMES.SENDGRID_API_KEY),
    getSecret(SECRET_NAMES.SENDGRID_FROM_EMAIL),
    getSecret(SECRET_NAMES.EDITOR_EMAIL),
    getSecret(SECRET_NAMES.WEB_APP_BASE_URL),
  ]);

  const link = `${baseUrl.replace(/\/$/, '')}/editor/${draft.id}?token=${draft.magicToken}`;

  const optionsPreview = draft.options
    .map((o, i) => `<p><strong>Vaihtoehto ${i + 1} (${o.template}):</strong><br>${escapeHtml(o.text)}</p>`)
    .join('\n');

  const body = {
    personalizations: [{ to: [{ email: editorEmail }] }],
    from: { email: fromEmail, name: 'Natsastore sisältöpipeline' },
    subject: `Natsastore: ${draft.date} päivän postausluonnokset odottavat tarkistusta`,
    content: [
      {
        type: 'text/html',
        value: `
          <p>Päivän uutispohjainen aihe (pilari: ${draft.pillar}):</p>
          ${draft.sourceNews ? `<p><a href="${draft.sourceNews.url}">${escapeHtml(draft.sourceNews.title)}</a></p>` : ''}
          ${optionsPreview}
          <p><a href="${link}">Avaa muokkaustyökalu ja julkaise →</a></p>
          <p>Linkki vanhenee 48 tunnin kuluttua.</p>
        `,
      },
    ],
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

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
