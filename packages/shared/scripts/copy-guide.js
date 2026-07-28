// Copies the single-source-of-truth content guide (assets/natsastore-sisaltoopas.md
// at the repo root) into the compiled lib/ output so it can be read at runtime
// by both the Cloud Functions backend and the Next.js web app, without
// duplicating the file anywhere in source control.
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '../../../assets/natsastore-sisaltoopas.md');
const destDir = path.resolve(__dirname, '../lib/content');
const dest = path.join(destDir, 'guide.md');

if (!fs.existsSync(src)) {
  throw new Error(`Content guide not found at ${src}`);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`Copied content guide to ${dest}`);
