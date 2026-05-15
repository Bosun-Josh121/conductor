import { Keypair } from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENTITIES = [
  // Role wallets (new for Conductor)
  'platform',
  'verifier',
  'arbiter',
  // Specialist agent wallets
  'stellar-oracle',
  'web-intel',
  'web-intel-v2',
  'analysis',
  'reporter',
];

async function friendbotFund(publicKey: string): Promise<boolean> {
  try {
    const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
    if (res.ok) {
      console.log(`  ✓ Friendbot funded: ${publicKey}`);
      return true;
    } else {
      const body = await res.text();
      // 400 means already funded — not an error
      if (body.includes('already funded') || body.includes('createAccountAlreadyExist')) {
        console.log(`  ✓ Already funded: ${publicKey}`);
        return true;
      }
      console.warn(`  ⚠ Friendbot failed for ${publicKey}: ${body.slice(0, 100)}`);
      return false;
    }
  } catch (err) {
    console.warn(`  ⚠ Friendbot error for ${publicKey}: ${err}`);
    return false;
  }
}

async function main() {
  const wallets: Record<string, { publicKey: string; secretKey: string }> = {};

  console.log('='.repeat(60));
  console.log('Conductor — Wallet Setup');
  console.log('='.repeat(60));
  console.log('Generating wallets and funding via Friendbot...\n');

  for (const name of ENTITIES) {
    const kp = Keypair.random();
    wallets[name] = { publicKey: kp.publicKey(), secretKey: kp.secret() };
    console.log(`[${name}]`);
    console.log(`  Public Key : ${kp.publicKey()}`);
    await friendbotFund(kp.publicKey());
    await new Promise(r => setTimeout(r, 1200));
  }

  const walletsPath = path.join(__dirname, '..', 'wallets.json');
  fs.writeFileSync(walletsPath, JSON.stringify(wallets, null, 2));
  console.log('\n✓ Saved wallets.json (gitignored — keep this safe!)\n');

  console.log('─'.repeat(60));
  console.log('Add the following to your .env file:');
  console.log('─'.repeat(60));

  const envMap: Record<string, string> = {
    'platform': 'PLATFORM_SECRET_KEY',
    'verifier': 'VERIFIER_SECRET_KEY',
    'arbiter': 'ARBITER_SECRET_KEY',
    'stellar-oracle': 'STELLAR_ORACLE_SECRET_KEY',
    'web-intel': 'WEB_INTEL_SECRET_KEY',
    'web-intel-v2': 'WEB_INTEL_V2_SECRET_KEY',
    'analysis': 'ANALYSIS_AGENT_SECRET_KEY',
    'reporter': 'REPORT_AGENT_SECRET_KEY',
  };

  for (const [name, w] of Object.entries(wallets)) {
    const envKey = envMap[name] ?? (name.toUpperCase().replace(/-/g, '_') + '_SECRET_KEY');
    console.log(`# ${name} wallet: ${w.publicKey}`);
    console.log(`# Explorer: https://stellar.expert/explorer/testnet/account/${w.publicKey}`);
    console.log(`${envKey}=${w.secretKey}`);
    console.log('');
  }

  console.log('─'.repeat(60));
  console.log('NEXT STEPS:');
  console.log('─'.repeat(60));
  console.log('1. Copy the above env vars into your .env file');
  console.log('2. Run: npm run add-usdc-trustlines');
  console.log('3. Run: npm run distribute-usdc');
  console.log('4. Verify balances at https://stellar.expert/explorer/testnet');
  console.log('');
  console.log('Role wallet summary:');
  console.log(`  Platform  (releaseSigner): ${wallets['platform']?.publicKey}`);
  console.log(`  Verifier  (approver):      ${wallets['verifier']?.publicKey}`);
  console.log(`  Arbiter   (disputeRes):    ${wallets['arbiter']?.publicKey}`);
}

main().catch(console.error);
