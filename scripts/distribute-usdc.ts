/**
 * Distributes testnet USDC from the platform wallet to agent wallets.
 * Agents receive a small reserve; the platform wallet holds the bulk for escrow funding.
 */
import {
  Keypair,
  Asset,
  TransactionBuilder,
  Operation,
  Networks,
  Horizon,
  Memo,
} from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);
const server = new Horizon.Server(HORIZON_URL);

// Agents receive small reserves for gas/fees; escrow payments go via TW release
const DISTRIBUTION: Record<string, string> = {
  'stellar-oracle': '1',
  'web-intel':      '1',
  'web-intel-v2':   '1',
  'analysis':       '1',
  'reporter':       '1',
};

async function sendUSDC(
  senderKeypair: Keypair,
  destinationPublicKey: string,
  amount: string,
  label: string
): Promise<void> {
  const account = await server.loadAccount(senderKeypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: destinationPublicKey, asset: USDC, amount }))
    .addMemo(Memo.text(`Conductor: ${label}`))
    .setTimeout(30)
    .build();
  tx.sign(senderKeypair);
  const result = await server.submitTransaction(tx);
  console.log(`  ✓ Sent ${amount} USDC to [${label}] — tx: ${result.hash}`);
}

async function getUSDCBalance(publicKey: string): Promise<string> {
  try {
    const account = await server.loadAccount(publicKey);
    const usdc = account.balances.find(
      (b: any) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER
    ) as any;
    return usdc?.balance || '0';
  } catch {
    return 'N/A';
  }
}

async function main() {
  const walletsPath = path.join(__dirname, '..', 'wallets.json');
  if (!fs.existsSync(walletsPath)) {
    console.error('wallets.json not found. Run: npm run setup-wallets first.');
    process.exit(1);
  }

  const wallets = JSON.parse(fs.readFileSync(walletsPath, 'utf-8'));

  if (!wallets.platform) {
    console.error('No platform wallet in wallets.json. Run: npm run setup-wallets');
    process.exit(1);
  }

  const platformKeypair = Keypair.fromSecret(wallets.platform.secretKey);
  const platformBalance = await getUSDCBalance(wallets.platform.publicKey);
  console.log(`Platform wallet USDC balance: ${platformBalance}`);
  console.log('Distributing USDC to agent wallets...\n');

  for (const [name, amount] of Object.entries(DISTRIBUTION)) {
    if (!wallets[name]) {
      console.warn(`  ⚠ No wallet found for [${name}], skipping`);
      continue;
    }
    const before = await getUSDCBalance(wallets[name].publicKey);
    if (parseFloat(before) >= parseFloat(amount)) {
      console.log(`  [${name}] already has ${before} USDC, skipping`);
      continue;
    }
    await sendUSDC(platformKeypair, wallets[name].publicKey, amount, name);
    await new Promise(r => setTimeout(r, 800));
  }

  console.log('\nFinal balances:');
  for (const [name, w] of Object.entries(wallets) as [string, any][]) {
    const bal = await getUSDCBalance(w.publicKey);
    console.log(`  [${name}] ${w.publicKey.slice(0, 8)}... → ${bal} USDC`);
  }
}

main().catch(console.error);
