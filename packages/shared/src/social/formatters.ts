import { PLATFORM_CHAR_LIMITS, SocialPlatform } from '../types';

export interface FormatResult {
  text: string;
  withinLimit: boolean;
  charCount: number;
  limit: number;
}

/** Grapheme-aware length check (good enough for Bluesky's grapheme-cluster limit). */
export function graphemeLength(text: string): number {
  if (typeof (Intl as any).Segmenter === 'function') {
    const segmenter = new (Intl as any).Segmenter('fi', { granularity: 'grapheme' });
    return [...segmenter.segment(text)].length;
  }
  return Array.from(text).length;
}

export function checkPlatformLength(platform: SocialPlatform, text: string): FormatResult {
  const limit = PLATFORM_CHAR_LIMITS[platform];
  const charCount = graphemeLength(text);
  return { text, withinLimit: charCount <= limit, charCount, limit };
}
