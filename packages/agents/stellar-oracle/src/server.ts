/**
 * StellarOracle — live Stellar blockchain data agent.
 * Payment via Trustless Work escrow release (no inline payment middleware).
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Keypair } from '@stellar/stellar-sdk';
import { getXLMUSDCTrades, getOrderbook, getAccountBalances, getNetworkStats } from './horizon.js';
import { registerSelf } from './register.js';

const PORT = parseInt(process.env.STELLAR_ORACLE_PORT || process.env.PORT || '4001');
const SECRET_KEY = process.env.STELLAR_ORACLE_SECRET_KEY!;

if (!SECRET_KEY) {
  console.error('[StellarOracle] STELLAR_ORACLE_SECRET_KEY not set');
  process.exit(1);
}

const keypair = Keypair.fromSecret(SECRET_KEY);
const AGENT_ADDRESS = keypair.publicKey();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agent: 'StellarOracle', address: AGENT_ADDRESS });
});

app.get('/', (_req, res) => {
  res.json({
    agent: 'StellarOracle',
    description: 'Live Stellar blockchain data — DEX trades, orderbooks, crypto prices',
    capabilities: ['blockchain-data', 'crypto-prices', 'stellar-dex', 'orderbook', 'network-stats', 'market-data'],
    pricing: { model: 'free', price_per_call: 0.02, currency: 'USDC' },
    stellar_address: AGENT_ADDRESS,
  });
});

app.post('/query', async (req, res) => {
  try {
    const { query = '', instruction, context } = req.body;
    const q = (query || instruction || '').toLowerCase();

    const wantsTrades   = q.includes('trade') || q.includes('price') || q.includes('xlm') || q.includes('market') || q === '';
    const wantsOrderbook = q.includes('order') || q.includes('book') || q.includes('bid') || q === '';
    const wantsNetwork  = q.includes('network') || q.includes('ledger') || q.includes('stats') || q === '';
    const wantsBalances = q.includes('balance') || q.includes('account');

    const [trades, orderbook, networkStats] = await Promise.all([
      wantsTrades   ? getXLMUSDCTrades(10) : Promise.resolve(null),
      wantsOrderbook ? getOrderbook() : Promise.resolve(null),
      wantsNetwork  ? getNetworkStats() : Promise.resolve(null),
    ]);

    let balances = null;
    if (wantsBalances) {
      const addressMatch = (query || instruction || '').match(/G[A-Z0-9]{55}/);
      if (addressMatch) {
        balances = await getAccountBalances(addressMatch[0]);
      }
    }

    const result: Record<string, any> = { query: q, timestamp: new Date().toISOString() };
    if (trades)      result.stellar_dex_trades = trades;
    if (orderbook)   result.stellar_dex_orderbook = orderbook;
    if (networkStats) result.network_stats = networkStats;
    if (balances)    result.account_balances = balances;
    if (context)     result.context_received = true;

    res.json({ result: JSON.stringify(result, null, 2), agent: 'StellarOracle', timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[StellarOracle] Query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[StellarOracle] Running on port ${PORT} | Wallet: ${AGENT_ADDRESS}`);
  registerSelf();
});
