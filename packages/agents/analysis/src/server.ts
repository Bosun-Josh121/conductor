/**
 * AnalysisBot — data analysis and trend identification agent.
 * Payment is handled by Trustless Work escrow release (no inline payment middleware).
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Keypair } from '@stellar/stellar-sdk';
import { analyzeWithClaude } from './analyze.js';
import { registerSelf } from './register.js';

const PORT = parseInt(process.env.ANALYSIS_AGENT_PORT || process.env.PORT || '4004');
const SECRET_KEY = process.env.ANALYSIS_AGENT_SECRET_KEY!;

if (!SECRET_KEY) {
  console.error('[AnalysisBot] ANALYSIS_AGENT_SECRET_KEY not set');
  process.exit(1);
}

const keypair = Keypair.fromSecret(SECRET_KEY);
const AGENT_ADDRESS = keypair.publicKey();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'AnalysisBot', address: AGENT_ADDRESS });
});

app.get('/', (_req, res) => {
  res.json({
    agent: 'AnalysisBot',
    description: 'Claude-powered data analysis. Identifies trends, risks, and insights.',
    capabilities: ['data-analysis', 'comparison', 'trend-analysis', 'sentiment-analysis', 'risk-assessment'],
    pricing: { model: 'free', price_per_call: 0.005, currency: 'USDC' },
    stellar_address: AGENT_ADDRESS,
  });
});

app.post('/analyze', async (req, res) => {
  try {
    const {
      data = '',
      instruction = 'Analyze this data and identify key trends, risks, and insights.',
      context,
    } = req.body;

    const inputData = context
      ? `${data}\n\nContext from previous steps:\n${context}`
      : (typeof data === 'string' ? data : JSON.stringify(data));

    const analysis = await analyzeWithClaude(inputData, instruction);
    res.json({ result: analysis, agent: 'AnalysisBot', timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[AnalysisBot] Analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[AnalysisBot] Running on port ${PORT} | Wallet: ${AGENT_ADDRESS}`);
  registerSelf();
});
