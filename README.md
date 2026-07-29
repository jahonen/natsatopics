# Natsastore sisältöpipeline

Daily pipeline that scrapes YLE news, drafts Natsastore social media posts
with Mistral (Vertex AI Model Garden) per `assets/natsastore-sisaltoopas.md`,
emails an editor a magic link to review/finalise, and publishes to Facebook,
Threads and Bluesky.

**Status: live.** The full pipeline (scrape → classify → draft → branded
email → editor review → cross-platform publish) has run successfully
end-to-end in production.

GCP / Firebase project: **natsatopics** (project number 545867466523).

See `docs/component.md` and `docs/services.md` for a per-unit breakdown,
or `START_HERE.md` for a structure/convention-first onboarding overview.

## Repo layout

```
packages/shared/   Types, content-guide loader, Mistral (Vertex AI) client,
                    pillar tracker, red-flag filter, platform formatters.
functions/          Firebase Cloud Functions v2: daily scheduled pipeline,
                    editorApi HTTPS endpoints, branded email sender,
                    publish pipelines.
web/                Next.js app deployed via Firebase App Hosting: the
                    magic-link editor UI (Tiptap). public/ holds the app
                    icons/favicons (also reused as the email logo).
docs/               component.md / services.md documentation.
assets/             natsastore-sisaltoopas.md (canonical content guide) +
                    source branding files (favicons, app icons).
```

## One-time setup

1. **Install dependencies** (npm workspaces, run from repo root):
   ```
   npm install
   ```

2. **Create secrets in Google Secret Manager** (project `natsatopics`):
   `SENDGRID_API_KEY`,
   `WEB_APP_BASE_URL`, `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`,
   `THREADS_USER_ID`, `THREADS_ACCESS_TOKEN`, `BLUESKY_IDENTIFIER`,
   `BLUESKY_APP_PASSWORD`. Full list/purpose in `docs/services.md`.
   ```
   printf '%s' "<value>" | gcloud secrets create SECRET_NAME --data-file=- --project=natsatopics
   ```
   Grant the Cloud Functions runtime service account access:
   ```
   gcloud projects add-iam-policy-binding natsatopics \
     --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```

   **Create `EDITOR_EMAIL` and `SENDGRID_FROM_EMAIL` in Google Cloud
   Parameter Manager** instead — they're plain configuration, not
   credentials:
   ```
   gcloud parametermanager parameters create EDITOR_EMAIL \
     --project=natsatopics --location=global --parameter-format=UNFORMATTED
   printf '%s' "<editor email>" | gcloud parametermanager parameters versions create v1 \
     --parameter=EDITOR_EMAIL --project=natsatopics --location=global --payload-data-from-file=-

   gcloud parametermanager parameters create SENDGRID_FROM_EMAIL \
     --project=natsatopics --location=global --parameter-format=UNFORMATTED
   printf '%s' "<verified sender email>" | gcloud parametermanager parameters versions create v1 \
     --parameter=SENDGRID_FROM_EMAIL --project=natsatopics --location=global --payload-data-from-file=-

   gcloud parametermanager parameters create AI_MODEL_NAME \
     --project=natsatopics --location=global --parameter-format=UNFORMATTED
   printf 'mistral-medium-3' | gcloud parametermanager parameters versions create v1 \
     --parameter=AI_MODEL_NAME --project=natsatopics --location=global --payload-data-from-file=-

   gcloud parametermanager parameters create AI_MODEL_LOCATION \
     --project=natsatopics --location=global --parameter-format=UNFORMATTED
   printf 'europe-west4' | gcloud parametermanager parameters versions create v1 \
     --parameter=AI_MODEL_LOCATION --project=natsatopics --location=global --payload-data-from-file=-

   gcloud projects add-iam-policy-binding natsatopics \
     --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
     --role="roles/parametermanager.parameterAccessor"
   ```

   **Enable the Mistral models in Vertex AI Model Garden** (manual,
   one-time — not automatable via `gcloud`/API, requires accepting the
   EULA in the console): open the Mistral Medium 3 and Mistral Small 3.1
   (25.03) model cards under Vertex AI → Model Garden → `mistralai`
   publisher for project `natsatopics`, and click **Enable** on each.

3. **Enable required APIs** (if not already):
   ```
   gcloud services enable aiplatform.googleapis.com secretmanager.googleapis.com \
     parametermanager.googleapis.com cloudfunctions.googleapis.com \
     cloudscheduler.googleapis.com firestore.googleapis.com \
     run.googleapis.com --project=natsatopics
   ```

4. **Create the Firestore database** (Native mode) in the Firebase console
   or via `gcloud firestore databases create --location=europe-west1
   --project=natsatopics` if it doesn't exist yet.

5. **Seed the content bank** (nostalgia/history prompts, luku 6 — starter
   set is in `functions/src/seedData.ts`, expand toward 30/20 over time):
   ```
   npm run seed -w functions
   ```
   Requires `gcloud auth application-default login` against `natsatopics`.

## Deploy

```
firebase deploy --only functions,firestore
```

`firebase.json`'s `predeploy` hook runs `scripts/vendor-shared.sh`, which
builds `packages/shared` and packs it into both
`functions/vendor/natsatopics-shared.tgz` **and**
`web/vendor/natsatopics-shared.tgz` (both committed, not gitignored —
App Hosting builds `web/` directly from the git repo, so unlike `functions/`
it can't be regenerated by a predeploy hook at deploy time). This is
required because neither Cloud Build (`functions/`) nor App Hosting
(`web/`) can resolve the `packages/shared` npm workspace when building each
directory in isolation; both `functions/package.json` and
`web/package.json` depend on their respective tarball via a `file:`
reference. **After any change to `packages/shared`, run
`bash scripts/vendor-shared.sh` and re-run `npm install` in both
`functions/` and `web/` before committing** — otherwise the deployed code
silently uses a stale copy.

Note the printed `editorApi` URL, then set it as
`NEXT_PUBLIC_EDITOR_API_URL` in `web/apphosting.yaml` (already pre-filled
with the expected `europe-west1` URL — verify it matches) and as the
`WEB_APP_BASE_URL` secret's counterpart, `WEB_APP_BASE_URL` itself should
be the App Hosting site's own URL once deployed.

Deploy the web app via Firebase App Hosting. One-time backend creation:
```
firebase apphosting:backends:create --project=natsatopics
```
then follow the CLI prompts to connect this repo with `web/` as the app
root. Every subsequent deploy is a rollout against a `main` push (App
Hosting builds directly from git, not from local files):
```
git push origin main
firebase apphosting:rollouts:create natsatopics --project=natsatopics --git-branch main
```

## Local development

```
npm run emulators        # Firestore + Functions emulators
cp web/.env.local.example web/.env.local
npm run dev:web           # Next.js dev server against the emulator
```

## Daily pipeline flow (see `docs/services.md` for detail)

1. `dailyContentPipeline` (06:00 Europe/Helsinki) picks the week's most
   under-represented pillar (luku 6: nostalgia 40% / geopolitics 25% /
   reserve 20% / history 15%).
2. Nostalgia/history → pulls from Firestore's `contentBank`. Otherwise →
   scrapes YLE RSS, red-flag filters (luku 8.3), and asks Mistral
   (`mistral-small-2503`) to classify each candidate + pick a pillar.
3. Mistral (`mistral-medium-3`) drafts 3 options in Finnish-quality-checked
   prompts (see `packages/shared/src/ai.ts`); a Firestore `drafts/{id}` doc
   is created with a magic token, and the editor is emailed a branded link
   via SendGrid — showing the source news excerpt and each option as its
   own deep link into the editor.
4. Editor opens `/editor/{draftId}?token=...&optionId=...`, picks/edits a
   message with Tiptap, saves, and publishes.
5. `editorApi`'s `publish` route forks the final text to Facebook, Threads
   and Bluesky, using Mistral to shorten text that exceeds a platform's
   character limit first.
6. `weeklyAnalyticsEmail` (Monday 07:00 Europe/Helsinki) analyses the ISO
   week that just ended — pillar mix vs. target shares, per-platform
   success/failure, content bank stock — and emails the editor a summary
   with recommendations.
