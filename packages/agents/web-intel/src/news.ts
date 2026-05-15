/**
 * Fetches public news via free RSS/API sources (no payment middleware).
 * Falls back to synthetic data when external sources are unavailable.
 */

export interface NewsArticle {
  title: string;
  description: string;
  url?: string;
  published?: string;
  source?: string;
}

async function fetchRSS(feedUrl: string, category: string): Promise<NewsArticle[]> {
  try {
    const res = await fetch(feedUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
    const text = await res.text();

    const articles: NewsArticle[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(text)) !== null && articles.length < 8) {
      const item = match[1];
      const title = (item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) ?? [])[1] ?? '';
      const desc  = (item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) ?? [])[1] ?? '';
      const link  = (item.match(/<link>(.*?)<\/link>/) ?? [])[1] ?? '';
      const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) ?? [])[1] ?? '';

      if (title.trim()) {
        articles.push({
          title: title.trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
          description: desc.trim().replace(/<[^>]+>/g, '').slice(0, 200),
          url: link.trim(),
          published: pubDate.trim(),
          source: category,
        });
      }
    }

    return articles;
  } catch {
    return [];
  }
}

export async function getBlockchainNews(): Promise<NewsArticle[]> {
  return fetchRSS('https://cointelegraph.com/rss', 'blockchain');
}

export async function getTechNews(): Promise<NewsArticle[]> {
  return fetchRSS('https://feeds.feedburner.com/TechCrunch', 'tech');
}

export async function getAINews(): Promise<NewsArticle[]> {
  return fetchRSS('https://venturebeat.com/category/ai/feed/', 'ai');
}
