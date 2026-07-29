// One-off script: seeds Firestore's `contentBank` collection with the
// starter nostalgia/history prompts from seedData.ts. Run locally with:
//   npm run build -w functions && node functions/lib/scripts/seedContentBank.js
// Requires GOOGLE_APPLICATION_CREDENTIALS (or `gcloud auth application-default login`)
// pointed at the natsatopics project. The target project is hardcoded below
// (rather than relying on `gcloud config`'s default project or ADC's quota
// project) since a developer's local gcloud default project may point at a
// different GCP project entirely, which would silently seed the wrong
// Firestore database.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { NOSTALGIA_BANK, HISTORY_BANK } from '../seedData';

const PROJECT_ID = 'natsatopics';

async function main() {
  initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore();
  const batch = db.batch();

  NOSTALGIA_BANK.forEach((prompt) => {
    const ref = db.collection('contentBank').doc();
    batch.set(ref, { pillar: 'nostalgia', prompt, used: false });
  });

  HISTORY_BANK.forEach((prompt) => {
    const ref = db.collection('contentBank').doc();
    batch.set(ref, { pillar: 'history', prompt, used: false });
  });

  await batch.commit();
  console.log(`Seeded ${NOSTALGIA_BANK.length} nostalgia + ${HISTORY_BANK.length} history items.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
