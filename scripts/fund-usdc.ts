import 'dotenv/config';
import {
  Keypair, Horizon, TransactionBuilder, Networks, BASE_FEE, Asset, Operation,
} from '@stellar/stellar-sdk';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const USDC_ISSUER = process.env.USDC_ASSET_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const server = new Horizon.Server(HORIZON_URL);

async function getPathCost(usdcAmount: string): Promise<number> {
  const res = await fetch(
    `${HORIZON_URL}/paths/strict-receive?source_assets=native&destination_asset_type=credit_alphanum4&destination_asset_code=USDC&destination_asset_issuer=${USDC_ISSUER}&destination_amount=${usdcAmount}`
  );
  const data: any = await res.json();
  const records = data._embedded?.records ?? [];
  if (records.length === 0) throw new Error('No path found for XLM→USDC');
  return parseFloat(records[0].source_amount);
}

async function swapXlmForUsdc(keypair: Keypair, usdcAmount: string, label: string): Promise<void> {
  const account = await server.loadAccount(keypair.publicKey());
  const balances: any[] = (account as any).balances;
  const existing = balances.find((b: any) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER);
  const currentUsdc = parseFloat(existing?.balance ?? '0');

  if (currentUsdc >= parseFloat(usdcAmount)) {
    console.log(`  [${label}] Already has ${currentUsdc} USDC — skipping`);
    return;
  }

  // Get actual path cost with 30% buffer for slippage
  const actualCostXlm = await getPathCost(usdcAmount);
  const sendMaxXlm = (actualCostXlm * 1.3).toFixed(7);
  console.log(`  [${label}] Path cost: ${actualCostXlm} XLM → ${usdcAmount} USDC (sendMax: ${sendMaxXlm})`);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.pathPaymentStrictReceive({
      sendAsset: Asset.native(),
      sendMax: sendMaxXlm,
      destination: keypair.publicKey(),
      destAsset: USDC,
      destAmount: usdcAmount,
      path: [],
    }))
    .setTimeout(60)
    .build();

  tx.sign(keypair);
  try {
    const result = await server.submitTransaction(tx);
    console.log(`  [${label}] ✓ Got ${usdcAmount} USDC — tx: ${result.hash}`);
  } catch (err: any) {
    const codes = err?.response?.data?.extras?.result_codes;
    console.error(`  [${label}] ✗ Failed:`, codes || err.message);
  }
}

async function main() {
  console.log('Funding wallets with USDC via testnet DEX...\n');

  // Platform: needs ~50 USDC to fund multiple escrows in testing
  const platformKp = Keypair.fromSecret(process.env.PLATFORM_SECRET_KEY!);
  await swapXlmForUsdc(platformKp, '50', 'platform');
  await new Promise(r => setTimeout(r, 3000));

  // Agents: 1 USDC each (they receive payments via escrow release)
  const agents: [string, string][] = [
    ['STELLAR_ORACLE_SECRET_KEY', 'stellar-oracle'],
    ['ANALYSIS_AGENT_SECRET_KEY', 'analysis'],
    ['REPORT_AGENT_SECRET_KEY', 'reporter'],
  ];

  for (const [envKey, label] of agents) {
    const secret = process.env[envKey];
    if (!secret) continue;
    await swapXlmForUsdc(Keypair.fromSecret(secret), '1', label);
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n=== Final USDC balances ===');
  const allWallets: [string, string][] = [
    ['PLATFORM_SECRET_KEY', 'platform'],
    ['VERIFIER_SECRET_KEY', 'verifier'],
    ['ARBITER_SECRET_KEY', 'arbiter'],
    ['STELLAR_ORACLE_SECRET_KEY', 'stellar-oracle'],
    ['ANALYSIS_AGENT_SECRET_KEY', 'analysis'],
    ['REPORT_AGENT_SECRET_KEY', 'reporter'],
  ];
  for (const [envKey, label] of allWallets) {
    const secret = process.env[envKey];
    if (!secret) continue;
    const kp = Keypair.fromSecret(secret);
    const acct = await server.loadAccount(kp.publicKey());
    const balances: any[] = (acct as any).balances;
    const usdc = balances.find((b: any) => b.asset_code === 'USDC');
    const xlm = balances.find((b: any) => b.asset_type === 'native');
    console.log(`  [${label}] ${parseFloat(xlm?.balance ?? '0').toFixed(1)} XLM  ${parseFloat(usdc?.balance ?? '0').toFixed(4)} USDC`);
  }
}

main().catch(console.error);
