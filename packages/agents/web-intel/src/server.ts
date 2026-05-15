/**
 * WebIntelligence — news and web research agent.
 * Payment via Trustless Work escrow release (no inline payment middleware).
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { Keypair } from '@stellar/stellar-sdk';
import { getBlockchainNews, getTechNews, getAINews } from './news.js';
import { registerSelf } from './register.js';

const PORT = parseInt(process.env.WEB_INTEL_PORT || process.env.PORT || '4002');
const SECRET_KEY = process.env.WEB_INTEL_SECRET_KEY!;

if (!SECRET_KEY) {
  console.error('[WebIntelligence] WEB_INTEL_SECRET_KEY not set');
  process.exit(1);
}

const keypair = Keypair.fromSecret(SECRET_KEY);
const AGENT_ADDRESS = keypair.publicKey();

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'WebIntelligence', address: AGENT_ADDRESS });
});

app.get('/', (_req, res) => {
  res.json({
    agent: 'WebIntelligence',
    description: 'News and web research across blockchain, tech, and AI.',
    capabilities: ['news', 'web-search', 'information-retrieval', 'blockchain-news', 'tech-news', 'ai-news', 'research'],
    pricing: { model: 'free', price_per_call: 0.02, currency: 'USDC' },
    stellar_address: AGENT_ADDRESS,
  });
});

app.post('/query', async (req, res) => {
  try {
    const { query = '', instruction, context } = req.body;
    const q = (query || instruction || '').toLowerCase();

    const wantsBlockchain = q.includes('blockchain') || q.includes('crypto') || q.includes('stellar') || q === '';
    const wantsTech = q.includes('tech') || q.includes('technology') || q === '';
    const wantsAI = q.includes('ai') || q.includes('artificial intelligence') || q === '';

    const fetches: Promise<any>[] = [];
    if (wantsBlockchain) fetches.push(getBlockchainNews().catch(() => []));
    if (wantsTech)       fetches.push(getTechNews().catch(() => []));
    if (wantsAI)         fetches.push(getAINews().catch(() => []));

    const newsResults = await Promise.all(fetches);
    const allArticles = newsResults.flat();

    let summary = `Found ${allArticles.length} articles.`;

    if (anthropic && allArticles.length > 0) {
      const articlesText = allArticles.slice(0, 10).map(a =>
        `- ${a.title}: ${a.description}`.slice(0, 200)
      ).join('\n');

      const claudeRes = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Extract 3-5 key insights from these news articles relevant to: "${q}"\n\n${articlesText}\n\nReturn a brief bullet-point summary.${context ? `\n\nContext: ${context}` : ''}`,
        }],
      }).catch(() => null);

      if (claudeRes?.content[0]?.type === 'text') {
        summary = claudeRes.content[0].text;
      }
    }

    const result = {
      articles: allArticles.slice(0, 15),
      article_count: allArticles.length,
      summary,
      categories: [
        wantsBlockchain ? 'blockchain' : null,
        wantsTech ? 'tech' : null,
        wantsAI ? 'ai' : null,
      ].filter(Boolean),
    };

    res.json({
      result: `${summary}\n\nArticles found: ${allArticles.slice(0, 5).map(a => `- ${a.title}`).join('\n')}`,
      agent: 'WebIntelligence',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[WebIntelligence] Query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[WebIntelligence] Running on port ${PORT} | Wallet: ${AGENT_ADDRESS}`);
  registerSelf();
});
