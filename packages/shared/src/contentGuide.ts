import * as fs from 'fs';
import * as path from 'path';

let cachedGuide: string | undefined;

/**
 * Loads the Natsastore content guide (sisältöopas). The canonical source is
 * assets/natsastore-sisaltoopas.md at the repo root; the shared package's
 * build step (scripts/copy-guide.js) copies it into lib/content/guide.md so
 * it ships inside this package for both the functions backend and the web
 * app to consume at runtime.
 */
export function loadContentGuide(): string {
  if (cachedGuide) return cachedGuide;
  const guidePath = path.join(__dirname, 'content', 'guide.md');
  cachedGuide = fs.readFileSync(guidePath, 'utf-8');
  return cachedGuide;
}
