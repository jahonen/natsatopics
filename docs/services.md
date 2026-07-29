# Service documentation

Every callable or deployable service in this project, per project
convention.

## `dailyContentPipeline` (scheduled Cloud Function)
- **File:** `functions/src/index.ts` (logic in `functions/src/dailyJob.ts`)
- **Trigger:** Cloud Scheduler, `0 6 * * *` Europe/Helsinki.
- **Inputs:** none (reads YLE RSS feeds and Firestore state).
- **Outputs:** creates one `drafts/{draftId}` Firestore document and emails
  the editor a magic link (with a news excerpt and per-option deep links,
  see `email.ts` below).
- **Side effects:** Firestore writes (`drafts`, `weeklyPillarCounts`,
  `contentBank`), SendGrid email send, Vertex AI (Mistral) calls, YLE RSS
  HTTP fetches.
- **Third-party dependencies:** SendGrid (email), Vertex AI Model Garden /
  Mistral (drafting + classification), YLE RSS feeds (news source, no auth
  key).
- **AI model quota note:** `classifyNewsItem` runs once per red-flag-passed
  news candidate (up to ~44/day) until one is accepted, and each call sends
  the full ~18KB content guide. This alone can exceed
  `mistral-medium-3`'s **31,500 tokens/min** Vertex AI quota in
  `europe-west4`/`us-central1` within a single run, so classification uses
  `mistral-small-2503` (200,000 tokens/min quota) instead — see
  `AiModelConfig` override in `dailyJob.ts`. Draft/copy generation (1-2
  calls/run, where Finnish grammatical quality matters most) stays on
  `mistral-medium-3`. If you see `Quota exceeded` errors, request a quota
  increase via the Vertex AI console rather than reverting this.

## `editorApi` (HTTPS Cloud Function)
- **File:** `functions/src/index.ts`
- **Routes:**
  - `GET /get-draft?draftId=&token=` — fetch a draft for the editor UI.
  - `POST /save-draft` — persist the editor's finalised text.
  - `POST /publish` — fork the finalised text to all platform pipelines.
- **Inputs:** `draftId`, magic-link `token` (validated server-side against
  Firestore's `magicToken`/`tokenExpiresAt` on every call).
- **Side effects:** Firestore reads/writes on `drafts/{draftId}`, and on
  `publish`, calls the Facebook/Threads/Bluesky publishing pipelines.

## `testBlueskyHello` (HTTPS Cloud Function)
- **File:** `functions/src/index.ts`, uses `publish/bluesky.ts` directly.
- **Lifecycle tag:** alpha (manual smoke test, not part of the daily pipeline).
- **Inputs:** none.
- **Outputs:** JSON `PlatformPostResult` (`status`, `postId`/`error`).
- **Side effects:** posts a "Hello World" record to Bluesky via the AT
  Protocol using the `BLUESKY_IDENTIFIER` / `BLUESKY_APP_PASSWORD` secrets.
- **Purpose:** verify Bluesky secrets and the publish path end-to-end
  without running `dailyContentPipeline` or the editor flow. Safe to
  delete once confirmed working.

## `refreshThreadsToken` (scheduled Cloud Function)
- **File:** `functions/src/index.ts` (logic in `functions/src/publish/threadsTokenRefresh.ts`)
- **Trigger:** Cloud Scheduler, `0 3 * * 1` (weekly, Monday) Europe/Helsinki.
- **Inputs:** none (reads `THREADS_ACCESS_TOKEN` secret).
- **Side effects:** calls Meta's Threads `th_refresh_token` endpoint and adds
  a new version to the `THREADS_ACCESS_TOKEN` secret via
  `secrets.ts`'s `addSecretVersion`.
- **Purpose:** Threads long-lived user tokens expire after 60 days; weekly
  refresh keeps a wide safety margin.
- Emails the editor (`EDITOR_EMAIL`) via `sendThreadsRefreshNotification`
  (`email.ts`) on every run, subject `Natsastore Threads token refresh
  [SUCCESS|FAIL]`, so a failure doesn't go unnoticed until the token
  actually expires.
- **Third-party dependencies:** Meta Graph API (Threads), SendGrid.

## `email` (`functions/src/email.ts`, not a standalone deployable service
but called by `dailyContentPipeline` and `refreshThreadsToken`)
- **Inputs:** `sendMagicLinkEmail(draft)`, `sendThreadsRefreshNotification(status, details)`.
- **Side effects:** sends HTML email via the SendGrid HTTP API directly (no
  Firebase Trigger Email extension, per project decision).
- Every email is wrapped in a shared branded HTML shell (`wrapEmailHtml`):
  Natsastore logo (`{WEB_APP_BASE_URL}/android-chrome-192x192.png`, i.e. the
  App Hosting site's own `/public` folder — see `web/public/` in
  `component.md`) and brand-orange accents.
- The daily draft-review email additionally shows the source news item's
  title/link/summary (when the pillar is news-driven), and makes each of
  the 3 draft options its own clickable magic link into the editor with
  that option pre-selected (`?optionId=...`), alongside the generic
  "open editor" link.
- **Sender avatar (Gravatar/BIMI):** not automatable from this codebase.
  Gravatar requires manually registering `SENDGRID_FROM_EMAIL` at
  gravatar.com with the logo uploaded; BIMI (what gets Gmail to show a
  sender logo) requires a DNS TXT record at the sending domain plus DMARC
  enforcement, and for guaranteed Gmail support a paid Verified Mark
  Certificate. Track in `integration.md` if pursued.

## Publishing pipelines (`functions/src/publish/*.ts`)
- **Facebook:** Graph API `POST /{page-id}/feed`. Secrets:
  `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`.
- **Threads:** Graph API two-step container create + publish. Secrets:
  `THREADS_USER_ID`, `THREADS_ACCESS_TOKEN`. Each post also carries a
  Threads Topic tag (`topic_tag` param) derived from `draft.pillar`, per
  `PILLAR_TOPIC_TAGS` in `publish/threads.ts`:
  `geopolitics`→`TURPO`, `reserve`→`Reservi`, `nostalgia`/`history`→`Maanpuolustus`.
- **Bluesky:** AT Protocol `createSession` + `createRecord`. Secrets:
  `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD`.
- Each pipeline first checks the platform's character limit
  (`packages/shared/social/formatters.ts`); if the message doesn't fit, it
  calls Mistral (`adaptForPlatform`) to shorten it before posting.

## Parameter Manager inventory (see `functions/src/params.ts`)
| Parameter name | Used by | Notes |
|---|---|---|
| `EDITOR_EMAIL` | `email.ts` | Recipient of the daily review email and refresh notifications. Not a credential, so it lives in Parameter Manager rather than Secret Manager. |
| `SENDGRID_FROM_EMAIL` | `email.ts` | Verified sender identity in SendGrid (`natsastore@nxtstride.com`). Not a credential either. |
| `AI_MODEL_NAME` / `AI_MODEL_LOCATION` | `dailyJob.ts` (drafting only — `classifyNewsItem` overrides to `mistral-small-2503`, see quota note above) | Vertex AI Model Garden model + region, e.g. `mistral-medium-3` / `europe-west4`. Kept in Parameter Manager rather than hardcoded so the model can be swapped without a code deploy if a provider retires a model. |

Parameter Manager's `getParameterVersion` does **not** support the
`latest` version alias (unlike Secret Manager's `accessSecretVersion`,
which does) — it 404s. `params.ts` uses `renderParameterVersion` instead.

## Secret Manager inventory (see `functions/src/secrets.ts`)
| Secret name | Used by | Notes |
|---|---|---|
| `SENDGRID_API_KEY` | `email.ts` | SendGrid HTTP API auth. |
| `WEB_APP_BASE_URL` | `email.ts` | Base URL of the App Hosting site, used to build the magic link. |
| `FACEBOOK_PAGE_ID` / `FACEBOOK_PAGE_ACCESS_TOKEN` | `publish/facebook.ts` | Page-level access token, not user token. |
| `THREADS_USER_ID` / `THREADS_ACCESS_TOKEN` | `publish/threads.ts` | Meta Threads API. |
| `BLUESKY_IDENTIFIER` / `BLUESKY_APP_PASSWORD` | `publish/bluesky.ts` | Use an app password, not the main account password. |

All of the above must be created in Google Secret Manager under project
`natsatopics` before the pipeline can run end-to-end; the functions'
service account needs `roles/secretmanager.secretAccessor`.

`EDITOR_EMAIL` and `SENDGRID_FROM_EMAIL` must be created in Parameter
Manager (`global` location); the functions' service account needs
`roles/parametermanager.parameterAccessor`.

## Integration tracking (external services)
- **SendGrid** — email delivery. Approval + account owned by user.
- **Vertex AI Model Garden (Mistral)** — drafting (`mistral-medium-3`),
  classification (`mistral-small-2503`), platform adaptation
  (`mistral-medium-3`). Third-party partner models require a one-time
  manual "Enable" click (accepting the EULA) per model in the Model Garden
  console — not automatable via `gcloud`/API, since it needs a Cloud
  Commerce Consumer Procurement entitlement. Billed to `natsatopics`.
- **Meta Graph API (Facebook + Threads)** — requires an approved Meta app
  with `pages_manage_posts` / Threads publishing permissions.
- **Bluesky AT Protocol** — no app review process; app password only.
- **YLE RSS feeds** — public, unauthenticated, no SLA guarantee.
- **Gravatar / BIMI** (sender avatar in email clients) — not yet set up;
  requires manual account/DNS work outside this codebase, see the `email`
  section above.
