import { Keypair } from '@stellar/stellar-sdk';

const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4000';
const PORT = process.env.REPORT_AGENT_PORT || '4005';
const SELF_URL = process.env.REPORT_AGENT_SELF_URL || `http://localhost:${PORT}`;
const SECRET_KEY = process.env.REPORT_AGENT_SECRET_KEY!;

let _attempt = 0;

export async function registerSelf(): Promise<void> {
  const keypair = Keypair.fromSecret(SECRET_KEY);

  const manifest = {
    agent_id: 'reporter-agent',
    name: 'ReporterBot',
    description: 'Claude-powered report writer. Converts data into structured markdown reports with executive summaries.',
    capabilities: ['report-writing', 'formatting', 'summarization', 'document-generation'],
    pricing: { model: 'free', price_per_call: 0.02, currency: 'USDC' },
    endpoint: `${SELF_URL}/report`,
    stellar_address: keypair.publicKey(),
    health_check: `${SELF_URL}/health`,
  };

  try {
    const res = await fetch(`${REGISTRY_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
    if (res.ok) {
      console.log(`[ReporterBot] Registered with registry at ${REGISTRY_URL}`);
      _attempt = 0;
      setTimeout(registerSelf, 4 * 60 * 1000);
    } else {
      scheduleRetry('ReporterBot');
    }
  } catch {
    scheduleRetry('ReporterBot');
  }
}

function scheduleRetry(label: string): void {
  const delays = [5000, 15000, 30000, 60000];
  const delay = delays[Math.min(_attempt, delays.length - 1)];
  console.warn(`[${label}] Registry unavailable, retrying in ${delay / 1000}s...`);
  _attempt++;
  setTimeout(registerSelf, delay);
}
