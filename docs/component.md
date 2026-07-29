# Component documentation

Every modular unit of functionality in this project, per project convention.

## Web app (`web/`, Firebase App Hosting, Next.js)

App icons/favicons and `site.webmanifest` live in `web/public/` (copied
from `assets/`, wired up in `web/src/app/layout.tsx`'s `metadata.icons` /
`metadata.manifest`); also reused as the logo in outgoing emails (see
`wrapEmailHtml` below) since `web/public/` is served at the App Hosting
site's own base URL.

### `EditorPage` — `web/src/components/EditorPage/EditorPage.tsx`
- **Lifecycle tag:** alpha
- **Inputs:** `draftId` (route param), `token` (magic-link query param),
  `initialOptionId` (optional query param — pre-selects that option instead
  of always defaulting to the first one, so each option's own link in the
  daily email can land directly on that option).
- **Outputs:** renders the draft's 3 AI-generated options, a Tiptap editor
  for the final cross-platform message, per-platform character counters,
  and Save/Publish actions.
- **Side effects:** calls `editorApiClient` (`get-draft`, `save-draft`,
  `publish`) against the `editorApi` Cloud Function. No direct Firestore
  access from the client.

### `PlatformCharCounter` — `web/src/components/PlatformCharCounter/PlatformCharCounter.tsx`
- **Lifecycle tag:** stable
- **Inputs:** `platform`, `charCount`, `limit`, `withinLimit` (from
  `checkPlatformLength` in `packages/shared`).
- **Outputs:** small badge showing `n / limit` per platform, styled red when
  over limit.
- **Side effects:** none (pure presentational).

### `DraftEditorRoute` — `web/src/app/editor/[draftId]/page.tsx`
- **Lifecycle tag:** alpha
- **Inputs:** Next.js dynamic route param `draftId`, search params `token`
  and optional `optionId`.
- **Outputs:** renders `EditorPage`, or an error message if `token` is
  missing.
- **Side effects:** none.

## Shared package (`packages/shared/`)

### `contentGuide` — `packages/shared/src/contentGuide.ts`
- Loads `assets/natsastore-sisaltoopas.md` (copied into the compiled
  package at build time) so it can be injected into every AI prompt.

### `pillarTracker` — `packages/shared/src/pillarTracker.ts`
- Tracks weekly per-pillar publish counts in Firestore
  (`weeklyPillarCounts`) and picks the most under-represented pillar
  against the guide's target shares (luku 6).

### `redFlags` — `packages/shared/src/redFlags.ts`
- Fast, deterministic pre-filter for the punaiset liput (luku 8.3) run
  before any AI call, to save cost on obviously disqualified news items.

### `contentBank` — `packages/shared/src/contentBank.ts`
- Picks/recycles nostalgia and history prompts (luku 6) from Firestore's
  `contentBank` collection, since those pillars don't come from news.

### `ai` — `packages/shared/src/ai.ts` (formerly `gemini.ts`, kept as a
re-export shim at that path for backwards compatibility)
- **Lifecycle tag:** alpha
- Server-only. Calls Mistral models on Vertex AI Model Garden directly via
  `rawPredict` HTTP calls (no `@google-cloud/vertexai` SDK — that only
  supports Google's own Gemini models, not partner models). Never import
  from client components — use deep imports of `types` or
  `social/formatters` instead (see
  `web/src/components/EditorPage/EditorPage.tsx` for the pattern) to avoid
  bundling this into the browser build.
- **Exports:**
  - `classifyNewsItem(projectId, news, config?)` — relevance/red-flag/pillar
    classification for one candidate news item.
  - `generateDrafts(projectId, news, pillar, config?)` /
    `generateBankDrafts(projectId, bankPrompt, pillar, config?)` — 3 draft
    options for a news-driven or content-bank-driven pillar.
  - `adaptForPlatform(projectId, finalText, platform, config?)` — shortens
    a finalised message to fit a platform's character limit.
  - `AiModelConfig` (`{ model, location }`, optional on every call above,
    defaults to `mistral-medium-3` / `europe-west4`) — lets callers override
    the model per call; `functions/src/dailyJob.ts` uses this to run
    `classifyNewsItem` on the cheaper/higher-quota `mistral-small-2503`
    while drafting stays on `mistral-medium-3` (see services.md quota
    note).
- **`FINNISH_QUALITY_INSTRUCTIONS`** (internal constant): explicit
  grammar-quality block injected into every copy-generating prompt
  (`generateDrafts`, `generateBankDrafts`, `adaptForPlatform`, not
  `classifyNewsItem` since that only produces internal reasoning text, not
  published copy) — requires complete subject+predicate sentences, correct
  case endings, compound words written as one word (a common LLM mistake in
  Finnish), correct comma usage, and a self-review pass before returning.

### `social/formatters` — `packages/shared/src/social/formatters.ts`
- Platform character-limit checks (`checkPlatformLength`), grapheme-aware
  for Bluesky. Safe for both client and server use.

### `weeklyAnalytics` — `packages/shared/src/weeklyAnalytics.ts`
- **Lifecycle tag:** alpha
- **Inputs:** `computeWeeklyStats(isoWeek, rangeStart, rangeEnd, drafts, contentBankRemaining)`
  — pure function, no Firestore access (the query lives in
  `functions/src/weeklyAnalyticsJob.ts` so this stays unit-testable without
  an emulator).
- **Outputs:** `WeeklyAnalyticsStats` (`packages/shared/src/types.ts`) —
  per-pillar counts/shares/deltas vs. `PILLAR_TARGET_SHARE`, per-platform
  posted/failed/AI-adapted counts, template usage, content bank remaining
  stock, and a Finnish-language `recommendations` list.
- **Side effects:** none.

## Functions (`functions/`, Firebase Cloud Functions v2)

### `dailyContentPipeline` — `functions/src/index.ts`, logic in `functions/src/dailyJob.ts`
- **Lifecycle tag:** alpha
- Scheduled trigger (06:00 Europe/Helsinki daily). Calls `runDailyPipeline`,
  which: picks the week's most under-represented pillar
  (`pickUnderrepresentedPillar`); for nostalgia/history pulls a prompt from
  the content bank (`generateBankDrafts`); otherwise scrapes YLE
  (`fetchYleNews`), red-flag pre-filters (`quickRedFlagCheck`), and loops
  candidates through `classifyNewsItem` until one is accepted
  (`generateDrafts`); then writes a `drafts/{id}` Firestore doc and emails
  the editor (`sendMagicLinkEmail`).
- `classifyNewsItem`'s per-candidate loop uses `mistral-small-2503`
  specifically (not the configured default `mistral-medium-3`) — with up to
  ~44 candidates/day and the full content guide sent on every call, that
  loop alone could exceed `mistral-medium-3`'s 31,500 tokens/min Vertex AI
  quota. See `docs/services.md` for the full quota note.

### `fetchYleNews` — `functions/src/yleScraper.ts`
- **Lifecycle tag:** alpha
- **Inputs:** `maxAgeHours` (default 30).
- **Outputs:** deduplicated `NewsItem[]` (by article URL) from Yle's public
  RSS feeds, used by `dailyJob.ts` (Vaihe 1).
- **Side effects:** fetches 3 feeds from `feeds.yle.fi`: two topic-filtered
  via `/uutiset/v1/recent.rss?publisherIds=YLE_UUTISET&concepts=<id>`
  (`18-34953` = Ulkomaat, `18-164292` = Ulko- ja turvallisuuspolitiikka —
  Yle's `majorHeadlines` endpoint has no dedicated foreign-news publisher,
  only `YLE_UUTISET`/`YLE_URHEILU`), plus the general
  `/uutiset/v1/majorHeadlines/YLE_UUTISET.rss` headlines feed to also catch
  domestic reservi/maanpuolustus stories that the topic feeds miss.

### `editorApi` — `functions/src/index.ts`
- **Lifecycle tag:** alpha
- HTTPS function exposing `get-draft`, `save-draft`, `publish` routes to
  the web app. Validates the magic-link token on every request.

### `email` — `functions/src/email.ts`
- **Lifecycle tag:** alpha
- **Inputs:** `sendMagicLinkEmail(draft)` (a `DraftDocument`);
  `sendThreadsRefreshNotification(status, details)`;
  `sendWeeklyAnalyticsEmail(stats)` (a `WeeklyAnalyticsStats`).
- **Outputs:** none (fire-and-forget send).
- **Side effects:** sends HTML email via the SendGrid HTTP API directly (no
  Firebase Trigger Email extension, per project decision).
- **`wrapEmailHtml(baseUrl, bodyHtml)`** (internal): shared branded shell
  used by every outgoing email — logo (`android-chrome-192x192.png`, served
  from the deployed web app's own `/public` folder via `WEB_APP_BASE_URL`)
  and brand-orange (`#f7941d`) accents.
- `sendMagicLinkEmail` shows the source news item's title, link, and
  summary (when the pillar came from news rather than the content bank),
  and renders each of the 3 draft options as its own clickable link straight
  into the editor with that option pre-selected
  (`{baseLink}&optionId={option.id}`), in addition to the generic
  "open editor" link.

### Publishing pipelines — `functions/src/publish/{facebook,threads,bluesky}.ts`
- **Lifecycle tag:** alpha
- One module per platform, each reading its own credentials from Secret
  Manager and posting via that platform's HTTP API.

### `refreshThreadsToken` — `functions/src/index.ts`
- **Lifecycle tag:** alpha
- Scheduled trigger (weekly, Monday 03:00 Europe/Helsinki). Calls
  `refreshThreadsAccessToken` (`functions/src/publish/threadsTokenRefresh.ts`)
  to rotate the 60-day Threads long-lived user token before it expires.

### `weeklyAnalyticsEmail` — `functions/src/index.ts`, logic in `functions/src/weeklyAnalyticsJob.ts`
- **Lifecycle tag:** alpha
- Scheduled trigger (weekly, Monday 07:00 Europe/Helsinki, after the 03:00
  Threads token refresh and before that day's 06:00 daily draft). Queries
  `drafts` for the ISO week that just ended (Monday-Sunday) by `date` range,
  counts remaining unused `contentBank` items per pillar, calls
  `computeWeeklyStats`, and emails the result via `sendWeeklyAnalyticsEmail`
  (`email.ts`). Firestore-only by design — no Cloud Logging/Monitoring API
  calls, since those would need IAM roles beyond what the runtime service
  account already has for the daily pipeline.

### `params` — `functions/src/params.ts`
- **Lifecycle tag:** stable
- **Inputs:** `getParameter(name)`, `getAiModelConfig()`.
- **Outputs:** cached string value / `{ model, location }`.
- **Side effects:** reads Google Cloud Parameter Manager
  (`global` location) via `renderParameterVersion` — **not**
  `getParameterVersion`, which 404s on the `latest` alias for Parameter
  Manager (unlike Secret Manager, where `latest` does work). Results are
  cached per warm instance for 5 minutes.

### `testBlueskyHello` — `functions/src/index.ts`
- **Lifecycle tag:** alpha
- Manual HTTPS smoke test that posts "Hello World" via
  `publish/bluesky.ts` to confirm the `BLUESKY_IDENTIFIER` /
  `BLUESKY_APP_PASSWORD` secrets and AT Protocol call path work. Not part
  of the daily pipeline.

### `testFacebookHello` — `functions/src/index.ts`
- **Lifecycle tag:** alpha
- Manual HTTPS smoke test that posts "Hello World" via
  `publish/facebook.ts` to confirm the `FACEBOOK_PAGE_ID` /
  `FACEBOOK_PAGE_ACCESS_TOKEN` secrets and Graph API call path work. Not
  part of the daily pipeline.

### `testThreadsHello` — `functions/src/index.ts`
- **Lifecycle tag:** alpha
- Manual HTTPS smoke test that posts "Hello World" via `publish/threads.ts`
  to confirm the `THREADS_USER_ID` / `THREADS_ACCESS_TOKEN` secrets and
  Graph API call path work. Not part of the daily pipeline.
