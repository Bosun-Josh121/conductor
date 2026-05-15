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
const USDC_ISSUER = process.env.USDC_ASSET_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

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

    // Format as human-readable markdown — use orderbook as authoritative price source
    // (Testnet trades may show stale prices from infrequent activity)
    const lines: string[] = [
      '# Stellar Oracle — Stellar Testnet DEX Data',
      `*Network: Stellar Testnet (soroban-testnet.stellar.org)*`,
      `*Asset pair: XLM (native) / USDC (${USDC_ISSUER.slice(0, 8)}…)*`,
      '',
    ];

    if (orderbook) {
      // Derive mid-price from orderbook (more reliable on testnet than trade history)
      const bestBid = parseFloat(orderbook.bids[0]?.price ?? '0');
      const bestAsk = parseFloat(orderbook.asks[0]?.price ?? '0');
      const midPrice = bestBid && bestAsk ? ((bestBid + bestAsk) / 2).toFixed(6) : 'N/A';

      lines.push('## Current XLM/USDC Price (from DEX Orderbook)');
      lines.push(`- **Mid price**: ${midPrice} USDC per XLM`);
      lines.push(`- **Best bid (buy XLM at)**: ${orderbook.bids[0]?.price ?? 'N/A'} USDC/XLM`);
      lines.push(`- **Best ask (sell XLM at)**: ${orderbook.asks[0]?.price ?? 'N/A'} USDC/XLM`);
      lines.push(`- **Spread**: ${orderbook.spread} USDC`);
      lines.push('');
      lines.push('## Top 5 Bids (buyers, descending price)');
      orderbook.bids.slice(0, 5).forEach((b: any, i: number) => {
        lines.push(`  ${i + 1}. Price: ${b.price} USDC/XLM | Amount: ${b.amount} XLM`);
      });
      lines.push('');
      lines.push('## Top 5 Asks (sellers, ascending price)');
      orderbook.asks.slice(0, 5).forEach((a: any, i: number) => {
        lines.push(`  ${i + 1}. Price: ${a.price} USDC/XLM | Amount: ${a.amount} XLM`);
      });
      lines.push('');
    }

    if (trades && trades.length > 0) {
      const latestPrice = parseFloat(trades[0].price);
      lines.push('## Recent Trade History (5 most recent trades)');
      lines.push(`- **Most recent trade price**: ${latestPrice.toFixed(6)} USDC per XLM`);
      lines.push(`- **Note**: Testnet trade history may differ from orderbook due to infrequent activity`);
      lines.push('');
      lines.push('| # | Timestamp (ISO 8601) | Price (USDC/XLM) | XLM Amount | USDC Amount |');
      lines.push('|---|---------------------|-----------------|------------|-------------|');
      trades.slice(0, 5).forEach((t: any, i: number) => {
        const ts = t.timestamp ?? '';  // full ISO 8601 e.g. 2026-05-15T18:34:56Z
        lines.push(`| ${i + 1} | ${ts} | ${t.price} | ${t.base_amount} | ${t.counter_amount} |`);
      });
      lines.push('');
    }

    if (networkStats) {
      lines.push(`## Network Stats`);
      lines.push(`- **Latest ledger**: ${networkStats.latest_ledger}`);
      lines.push(`- **Ops in ledger**: ${networkStats.total_operations}`);
      lines.push(`- **Closed at**: ${networkStats.closed_at}`);
      lines.push('');
    }

    if (balances) {
      lines.push(`## Account Balances`);
      balances.forEach((b: any) => lines.push(`- **${b.asset}**: ${b.balance}`));
      lines.push('');
    }

    lines.push(`*Data fetched at ${new Date().toISOString()}*`);
    const markdownResult = lines.join('\n');

    res.json({ result: markdownResult, agent: 'StellarOracle', timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[StellarOracle] Query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[StellarOracle] Running on port ${PORT} | Wallet: ${AGENT_ADDRESS}`);
  registerSelf();
});
