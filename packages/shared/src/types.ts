export type Pillar = 'nostalgia' | 'geopolitics' | 'reserve' | 'history';

export const PILLAR_TARGET_SHARE: Record<Pillar, number> = {
  nostalgia: 0.4,
  geopolitics: 0.25,
  reserve: 0.2,
  history: 0.15,
};

export type PostTemplate = 'A' | 'B' | 'C' | 'D';

export type SocialPlatform = 'facebook' | 'threads' | 'bluesky';

export const PLATFORM_CHAR_LIMITS: Record<SocialPlatform, number> = {
  // Facebook has no practical hard limit but posts perform best short; we
  // still enforce a generous ceiling to catch runaway AI output.
  facebook: 2000,
  threads: 500,
  bluesky: 300,
};

export interface NewsItem {
  title: string;
  url: string;
  summary: string;
  publishedAt: string; // ISO 8601
  feedCategory: string;
  tags?: string[];
}

export interface RedFlagCheck {
  flagged: boolean;
  reasons: string[];
}

export interface DraftOption {
  id: string;
  text: string;
  template: PostTemplate;
}

export type DraftStatus = 'pending_review' | 'approved' | 'published' | 'rejected' | 'expired';

export interface PlatformPostResult {
  status: 'pending' | 'posted' | 'failed';
  text?: string;
  postId?: string;
  postUrl?: string;
  postedAt?: string;
  error?: string;
}

export interface DraftDocument {
  id: string;
  date: string; // YYYY-MM-DD, Europe/Helsinki
  createdAt: string;
  sourceNews?: NewsItem;
  pillar: Pillar;
  options: DraftOption[];
  selectedOptionId?: string;
  finalText?: string;
  status: DraftStatus;
  magicToken: string;
  tokenExpiresAt: string;
  editorEmail: string;
  platformPosts?: Partial<Record<SocialPlatform, PlatformPostResult>>;
}

export interface WeeklyPillarCounts {
  isoWeek: string; // e.g. 2026-W31
  counts: Record<Pillar, number>;
}

export interface ContentBankItem {
  id: string;
  pillar: 'nostalgia' | 'history';
  prompt: string;
  used: boolean;
  lastUsedDate?: string;
}

export interface WeeklyAnalyticsStats {
  isoWeek: string;
  rangeStart: string; // YYYY-MM-DD
  rangeEnd: string; // YYYY-MM-DD
  totalDrafts: number;
  publishedCount: number;
  rejectedCount: number;
  pendingCount: number;
  pillarCounts: Record<Pillar, number>;
  pillarShares: Record<Pillar, number>;
  pillarDeltas: Record<Pillar, number>; // actual share - target share; negative = under-represented
  templateCounts: Partial<Record<PostTemplate, number>>;
  platformStats: Record<SocialPlatform, { posted: number; failed: number; adapted: number }>;
  contentBankRemaining: Record<'nostalgia' | 'history', number>;
  recommendations: string[];
}
