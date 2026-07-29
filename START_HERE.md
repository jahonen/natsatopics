# Start here — Natsastore sisältöpipeline

## Project structure

```
packages/shared/   Types, content-guide loader, Mistral (Vertex AI) client
                    (`ai.ts`), pillar tracker, red-flag filter, platform
                    formatters. Built + vendored into functions/ and web/
                    (see "Working with packages/shared" below).
functions/          Firebase Cloud Functions v2: daily scheduled pipeline
                    (dailyJob.ts), editorApi HTTPS endpoints (index.ts),
                    branded email sender (email.ts), Secret/Parameter
                    Manager readers (secrets.ts/params.ts), publish
                    pipelines (publish/{facebook,threads,bluesky}.ts).
web/                Next.js app on Firebase App Hosting: the magic-link
                    editor UI (EditorPage.tsx, Tiptap). public/ holds app
                    icons/favicons, also reused as the email logo.
docs/               component.md (every module) / services.md (every
                    callable/deployable service + third-party inventory).
assets/             natsastore-sisaltoopas.md — the canonical Finnish
                    content/brand voice guide injected into every AI
                    prompt — plus source branding files.
```

## Convention reference

- **Documentation:** every module → `docs/component.md`; every
  callable/deployable service → `docs/services.md`. Update both whenever
  you add or materially change one.
- **Styling:** `web/` uses `src/styles/main.scss` for shared styles;
  component-specific SCSS lives next to its component
  (`web/src/components/<Name>/<Name>.scss`).
- **Structure:** folders mirror logical structure; a component's files are
  co-located (e.g. `EditorPage.tsx` + `EditorPage.scss` in the same folder).
- **Naming:** components PascalCase, functions camelCase, files/folders
  kebab-case unless the framework dictates otherwise (Next.js route folders
  like `[draftId]` are framework-specific).
- **Lifecycle tags:** every component/service in `docs/component.md` /
  `docs/services.md` is tagged `alpha`, `beta`, `stable`, or `deprecated`.
  Most of this project is currently `alpha` — it just went live end-to-end
  for the first time.
- **Secrets vs. config:** credentials → Google Secret Manager
  (`functions/src/secrets.ts`); non-credential config (emails, AI model
  name/region) → Google Cloud Parameter Manager (`functions/src/params.ts`).
  See both files' inventories in `docs/services.md`.

## Boilerplate / patterns worth copying

- **Adding a new AI prompt:** add it to `packages/shared/src/ai.ts`,
  injecting `FINNISH_QUALITY_INSTRUCTIONS` into any prompt whose output
  gets published as-is (not into ones that only produce internal reasoning,
  like `classifyNewsItem`).
- **Adding a new secret/parameter:** add the name to `SECRET_NAMES` /
  `PARAMETER_NAMES` in the respective file, document it in
  `docs/services.md`'s inventory tables, and create it in GCP per
  `README.md`'s one-time setup section.
- **Changing `packages/shared`:** run `bash scripts/vendor-shared.sh`, then
  `npm install` in both `functions/` and `web/` (regenerates their
  lockfiles against the freshly-packed tarball), before committing —
  `web/vendor/` and `web/package-lock.json` are committed (not gitignored)
  because App Hosting builds `web/` straight from git.

## Where to go next

- `README.md` — one-time GCP setup, deploy commands, daily pipeline flow.
- `docs/component.md` — per-module inputs/outputs/side-effects.
- `docs/services.md` — per-service triggers, third-party dependencies, and
  the Secret/Parameter Manager inventories.
- `assets/natsastore-sisaltoopas.md` — the content/brand voice guide;
  changing pillar shares, red flags, or tone lives here, not in code.

## Support

Single-maintainer project (Jukkis Ahonen) — no separate support channel
set up yet.
