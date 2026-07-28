import { checkPlatformLength, DraftDocument, SocialPlatform, adaptForPlatform } from '@natsatopics/shared';
import { publishToFacebook } from './facebook';
import { publishToThreads } from './threads';
import { publishToBluesky } from './bluesky';
import { PlatformPostResult } from '@natsatopics/shared';

const PUBLISHERS: Record<SocialPlatform, (text: string) => Promise<PlatformPostResult>> = {
  facebook: publishToFacebook,
  threads: publishToThreads,
  bluesky: publishToBluesky,
};

/**
 * Vaihe 6 & 7: takes the editor-approved final message and forks it to each
 * platform's pipeline. Each pipeline first checks the platform's character
 * limit (packages/shared/social/formatters); if the message doesn't fit, an
 * AI rewrite (Gemini) shortens it before publishing.
 */
export async function forkAndPublish(
  projectId: string,
  draft: DraftDocument
): Promise<Partial<Record<SocialPlatform, PlatformPostResult>>> {
  const finalText = draft.finalText;
  if (!finalText) throw new Error(`Draft ${draft.id} has no finalText set`);

  const platforms: SocialPlatform[] = ['facebook', 'threads', 'bluesky'];
  const results: Partial<Record<SocialPlatform, PlatformPostResult>> = {};

  for (const platform of platforms) {
    let text = finalText;
    const check = checkPlatformLength(platform, text);
    if (!check.withinLimit) {
      try {
        text = await adaptForPlatform(projectId, finalText, platform);
      } catch (err: any) {
        results[platform] = { status: 'failed', text: finalText, error: `AI-muokkaus epäonnistui: ${err?.message ?? err}` };
        continue;
      }
    }

    try {
      results[platform] = await PUBLISHERS[platform](text);
    } catch (err: any) {
      results[platform] = { status: 'failed', text, error: err?.message ?? String(err) };
    }
  }

  return results;
}
