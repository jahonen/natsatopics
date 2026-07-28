# Natsastore sisältöpipeline

Daily pipeline that scrapes YLE news, drafts Natsastore social media posts
with Gemini per `assets/natsastore-sisaltoopas.md`, emails an editor a
magic link to review/finalise, and publishes to Facebook, Threads and
Bluesky.

GCP / Firebase project: **natsatopics** (project number 545867466523).

See `docs/component.md` and `docs/services.md` for a per-unit breakdown.

## Repo layout

```
packages/shared/   Types, content-guide loader, Gemini client, pillar
                    tracker, red-flag filter, platform formatters.
functions/          Firebase Cloud Functions v2: daily scheduled pipeline,
                    editorApi HTTPS endpoints, publish pipelines.
web/                Next.js app deployed via Firebase App Hosting: the
                    magic-link editor UI (Tiptap).
docs/               component.md / services.md documentation.
assets/             natsastore-sisaltoopas.md — canonical content guide.
```

## One-time setup

1. **Install dependencies** (npm workspaces, run from repo root):
   ```
   npm install
   ```

2. **Create secrets in Google Secret Manager** (project `natsatopics`):
   `EDITOR_EMAIL`, `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`,
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

3. **Enable required APIs** (if not already):
   ```
   gcloud services enable aiplatform.googleapis.com secretmanager.googleapis.com \
     cloudfunctions.googleapis.com cloudscheduler.googleapis.com \
     firestore.googleapis.com run.googleapis.com --project=natsatopics
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

Note the printed `editorApi` URL, then set it as
`NEXT_PUBLIC_EDITOR_API_URL` in `web/apphosting.yaml` (already pre-filled
with the expected `europe-west1` URL — verify it matches) and as the
`WEB_APP_BASE_URL` secret's counterpart, `WEB_APP_BASE_URL` itself should
be the App Hosting site's own URL once deployed.

Deploy the web app via Firebase App Hosting:
```
firebase apphosting:backends:create --project=natsatopics
```
then follow the CLI prompts to connect this repo with `web/` as the app
root, or use the IDE's deploy tooling pointed at `web/`.

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
   scrapes YLE RSS, red-flag filters (luku 8.3), and asks Gemini to
   classify + pick a pillar.
3. Gemini drafts 3 options; a Firestore `drafts/{id}` doc is created with a
   magic token, and the editor is emailed a link via SendGrid.
4. Editor opens `/editor/{draftId}?token=...`, picks/edits a message with
   Tiptap, saves, and publishes.
5. `editorApi`'s `publish` route forks the final text to Facebook, Threads
   and Bluesky, using Gemini to shorten text that exceeds a platform's
   character limit first.
