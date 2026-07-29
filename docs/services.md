# Service documentation

Every callable or deployable service in this project, per project
convention.

## `dailyContentPipeline` (scheduled Cloud Function)
- **File:** `functions/src/index.ts` (logic in `functions/src/dailyJob.ts`)
- **Trigger:** Cloud Scheduler, `0 6 * * *` Europe/Helsinki.
- **Inputs:** none (reads YLE RSS feeds and Firestore state).
- **Outputs:** creates one `drafts/{draftId}` Firestore document and emails
  the editor a magic link.
- **Side effects:** Firestore writes (`drafts`, `weeklyPillarCounts`,
  `contentBank`), SendGrid email send, Vertex AI (Gemini) calls, YLE RSS
  HTTP fetches.
- **Third-party dependencies:** SendGrid (email), Vertex AI/Gemini (drafting
  + classification), YLE RSS feeds (news source, no auth key).

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
  calls Gemini (`adaptForPlatform`) to shorten it before posting.

## Parameter Manager inventory (see `functions/src/params.ts`)
| Parameter name | Used by | Notes |
|---|---|---|
| `EDITOR_EMAIL` | `email.ts` | Recipient of the daily review email and refresh notifications. Not a credential, so it lives in Parameter Manager rather than Secret Manager. |
| `SENDGRID_FROM_EMAIL` | `email.ts` | Verified sender identity in SendGrid (`natsastore@nxtstride.com`). Not a credential either. |

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
- **Vertex AI (Gemini)** — drafting, classification, platform adaptation.
  Native GCP, billed to `natsatopics`.
- **Meta Graph API (Facebook + Threads)** — requires an approved Meta app
  with `pages_manage_posts` / Threads publishing permissions.
- **Bluesky AT Protocol** — no app review process; app password only.
- **YLE RSS feeds** — public, unauthenticated, no SLA guarantee.
