export interface NewsArticle {
  title: string;
  description: string;
  url?: string;
  source?: string;
}

export async function getBlockchainNews(): Promise<NewsArticle[]> {
  try {
    const res = await fetch('https://cointelegraph.com/rss', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const text = await res.text();
    const articles: NewsArticle[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(text)) !== null && articles.length < 5) {
      const item = match[1];
      const title = (item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) ?? [])[1] ?? '';
      const desc  = (item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) ?? [])[1] ?? '';
      if (title.trim()) {
        articles.push({
          title: title.trim().replace(/&amp;/g, '&'),
          description: desc.trim().replace(/<[^>]+>/g, '').slice(0, 150),
          source: 'blockchain',
        });
      }
    }
    return articles;
  } catch {
    return [];
  }
}
