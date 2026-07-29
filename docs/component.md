# Component documentation

Every modular unit of functionality in this project, per project convention.

## Web app (`web/`, Firebase App Hosting, Next.js)

### `EditorPage` — `web/src/components/EditorPage/EditorPage.tsx`
- **Lifecycle tag:** alpha
- **Inputs:** `draftId` (route param), `token` (magic-link query param).
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
- **Inputs:** Next.js dynamic route param `draftId`, search param `token`.
- **Outputs:** renders `EditorPage`, or an error message if `token` is
  missing.
- **Side effects:** none.

## Shared package (`packages/shared/`)

### `contentGuide` — `packages/shared/src/contentGuide.ts`
- Loads `assets/natsastore-sisaltoopas.md` (copied into the compiled
  package at build time) so it can be injected into every Gemini prompt.

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

### `gemini` — `packages/shared/src/gemini.ts`
- Server-only (Node `fs`/`@google-cloud/vertexai`). Never import from
  client components — use deep imports of `types` or `social/formatters`
  instead (see `web/src/components/EditorPage/EditorPage.tsx` for the
  pattern) to avoid bundling this into the browser build.

### `social/formatters` — `packages/shared/src/social/formatters.ts`
- Platform character-limit checks (`checkPlatformLength`), grapheme-aware
  for Bluesky. Safe for both client and server use.

## Functions (`functions/`, Firebase Cloud Functions v2)

### `dailyContentPipeline` — `functions/src/index.ts`
- **Lifecycle tag:** alpha
- Scheduled trigger (06:00 Europe/Helsinki daily). Calls `runDailyPipeline`.

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

### Publishing pipelines — `functions/src/publish/{facebook,threads,bluesky}.ts`
- **Lifecycle tag:** alpha
- One module per platform, each reading its own credentials from Secret
  Manager and posting via that platform's HTTP API.

### `refreshThreadsToken` — `functions/src/index.ts`
- **Lifecycle tag:** alpha
- Scheduled trigger (weekly, Monday 03:00 Europe/Helsinki). Calls
  `refreshThreadsAccessToken` (`functions/src/publish/threadsTokenRefresh.ts`)
  to rotate the 60-day Threads long-lived user token before it expires.

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
