import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import { NewsItem } from '@natsatopics/shared';

/**
 * Vaihe 1 — Syötteen rajaus: käytetään aihekohtaisia YLE-syötteitä
 * (turvallisuus/ulkomaat, ei yleisetusivua). Kotimaan politiikka -syöte on
 * tarkoituksella poissa tästä listasta; quickRedFlagCheck (packages/shared)
 * toimii lisäsuodattimena, jos jokin syöte joskus sisältäisi politiikka-
 * luokiteltuja juttuja.
 */
const YLE_FEEDS: Array<{ url: string; category: string }> = [
  { url: 'https://feeds.yle.fi/uutiset/v1/majorHeadlines/YLE_ULKOMAAT.rss', category: 'Ulkomaat' },
  { url: 'https://feeds.yle.fi/uutiset/v1/majorHeadlines/YLE_UUTISET.rss', category: 'Uutiset' },
];

interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  category?: string | string[];
  guid?: string;
}

export async function fetchYleNews(maxAgeHours = 30): Promise<NewsItem[]> {
  const parser = new XMLParser({ ignoreAttributes: false });
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  const items: NewsItem[] = [];

  for (const feed of YLE_FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: { 'User-Agent': 'natsatopics-bot/1.0' } });
      if (!res.ok) {
        console.warn(`YLE feed ${feed.url} returned ${res.status}`);
        continue;
      }
      const xml = await res.text();
      const parsed = parser.parse(xml);
      const rssItems: RssItem[] = parsed?.rss?.channel?.item ?? [];
      const asArray = Array.isArray(rssItems) ? rssItems : [rssItems];

      for (const item of asArray) {
        if (!item?.title || !item?.link) continue;
        const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();
        if (publishedAt.getTime() < cutoff) continue;

        items.push({
          title: item.title,
          url: item.link,
          summary: (item.description ?? '').replace(/<[^>]+>/g, '').trim(),
          publishedAt: publishedAt.toISOString(),
          feedCategory: feed.category,
        });
      }
    } catch (err) {
      console.error(`Failed to fetch/parse YLE feed ${feed.url}`, err);
    }
  }

  return items;
}
