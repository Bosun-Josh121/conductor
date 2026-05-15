import { Keypair } from '@stellar/stellar-sdk';

const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4000';
const PORT = process.env.WEB_INTEL_PORT || '4002';
const SELF_URL = process.env.WEB_INTEL_SELF_URL || `http://localhost:${PORT}`;
const SECRET_KEY = process.env.WEB_INTEL_SECRET_KEY!;

let _attempt = 0;

export async function registerSelf(): Promise<void> {
  const keypair = Keypair.fromSecret(SECRET_KEY);

  const manifest = {
    agent_id: 'web-intel',
    name: 'WebIntelligence',
    description: 'News and web research across blockchain, tech, and AI. Fetches and summarizes real articles.',
    capabilities: ['news', 'web-search', 'information-retrieval', 'blockchain-news', 'tech-news', 'ai-news', 'research'],
    pricing: { model: 'free', price_per_call: 0.02, currency: 'USDC' },
    endpoint: `${SELF_URL}/query`,
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
      console.log(`[WebIntelligence] Registered with registry at ${REGISTRY_URL}`);
      _attempt = 0;
      setTimeout(registerSelf, 4 * 60 * 1000);
    } else {
      scheduleRetry('WebIntelligence');
    }
  } catch {
    scheduleRetry('WebIntelligence');
  }
}

function scheduleRetry(label: string): void {
  const delays = [5000, 15000, 30000, 60000];
  const delay = delays[Math.min(_attempt, delays.length - 1)];
  console.warn(`[WebIntelligence] Registry unavailable, retrying in ${delay / 1000}s...`);
  _attempt++;
  setTimeout(registerSelf, delay);
}
