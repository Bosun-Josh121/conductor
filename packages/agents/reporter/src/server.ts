/**
 * ReporterBot — report writing and summarization agent.
 * Payment via Trustless Work escrow release (no inline payment middleware).
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Keypair } from '@stellar/stellar-sdk';
import { generateReport } from './report.js';
import { registerSelf } from './register.js';

const PORT = parseInt(process.env.REPORT_AGENT_PORT || process.env.PORT || '4005');
const SECRET_KEY = process.env.REPORT_AGENT_SECRET_KEY!;

if (!SECRET_KEY) {
  console.error('[ReporterBot] REPORT_AGENT_SECRET_KEY not set');
  process.exit(1);
}

const keypair = Keypair.fromSecret(SECRET_KEY);
const AGENT_ADDRESS = keypair.publicKey();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'ReporterBot', address: AGENT_ADDRESS });
});

app.get('/', (_req, res) => {
  res.json({
    agent: 'ReporterBot',
    description: 'Claude-powered report writer. Converts data into structured markdown reports.',
    capabilities: ['report-writing', 'formatting', 'summarization', 'document-generation'],
    pricing: { model: 'free', price_per_call: 0.02, currency: 'USDC' },
    stellar_address: AGENT_ADDRESS,
  });
});

app.post('/report', async (req, res) => {
  try {
    const { data, instruction, context } = req.body;

    let reportInput = '';
    if (instruction) reportInput += `Instruction: ${instruction}\n\n`;
    if (context) reportInput += `Context:\n${context}\n\n`;
    if (data) reportInput += typeof data === 'string' ? data : JSON.stringify(data, null, 2);

    if (!reportInput.trim()) {
      return res.status(400).json({ error: 'Provide data, instruction, or context' });
    }

    const report = await generateReport(reportInput);
    res.json({ result: report, agent: 'ReporterBot', timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[ReporterBot] Report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[ReporterBot] Running on port ${PORT} | Wallet: ${AGENT_ADDRESS}`);
  registerSelf();
});
