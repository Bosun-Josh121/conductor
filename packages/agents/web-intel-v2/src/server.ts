/**
 * WebIntelV2 — lightweight blockchain news agent.
 * Payment via Trustless Work escrow release (no inline payment middleware).
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Keypair } from '@stellar/stellar-sdk';
import { getBlockchainNews } from './news.js';
import { registerSelf } from './register.js';

const PORT = parseInt(process.env.WEB_INTEL_V2_PORT || process.env.PORT || '4003');
const SECRET_KEY = process.env.WEB_INTEL_V2_SECRET_KEY!;

if (!SECRET_KEY) {
  console.error('[WebIntelV2] WEB_INTEL_V2_SECRET_KEY not set');
  process.exit(1);
}

const keypair = Keypair.fromSecret(SECRET_KEY);
const AGENT_ADDRESS = keypair.publicKey();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'WebIntelV2', address: AGENT_ADDRESS });
});

app.get('/', (_req, res) => {
  res.json({
    agent: 'WebIntelV2',
    description: 'Lightweight blockchain news fetcher.',
    capabilities: ['news', 'blockchain-news', 'information-retrieval'],
    pricing: { model: 'free', price_per_call: 0.01, currency: 'USDC' },
    stellar_address: AGENT_ADDRESS,
  });
});

app.post('/query', async (req, res) => {
  try {
    const articles = await getBlockchainNews();
    const summary = articles.length > 0
      ? articles.slice(0, 5).map(a => `- ${a.title}: ${a.description}`).join('\n')
      : 'No articles found from news feed at this time.';

    res.json({
      result: summary,
      agent: 'WebIntelV2',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[WebIntelV2] Query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[WebIntelV2] Running on port ${PORT} | Wallet: ${AGENT_ADDRESS}`);
  registerSelf();
});
