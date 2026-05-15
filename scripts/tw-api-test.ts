import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import { Keypair, TransactionBuilder, Networks } from '@stellar/stellar-sdk';

const TW_API = process.env.TRUSTLESS_WORK_API_URL!;
const TW_KEY = process.env.TRUSTLESS_WORK_API_KEY!;
const platformKp = Keypair.fromSecret(process.env.PLATFORM_SECRET_KEY!);
const ADDR = platformKp.publicKey();

async function twPost(path: string, body: unknown) {
  const res = await fetch(TW_API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': TW_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  const deployPayload = {
    signer: ADDR,
    engagementId: uuidv4(),
    title: 'Contract ID Test',
    description: 'Testing contractId extraction from send-transaction response',
    roles: { approver: ADDR, serviceProvider: ADDR, platformAddress: ADDR, releaseSigner: ADDR, disputeResolver: ADDR },
    platformFee: 0,
    milestones: [{ description: 'Test: criteria 1) output exists', amount: 0.1, receiver: ADDR }],
    trustline: { address: process.env.USDC_ASSET_ISSUER!, symbol: 'USDC' },
  };

  console.log('1. Getting unsigned XDR from /deployer/multi-release...');
  const deployResp = await twPost('/deployer/multi-release', deployPayload);
  console.log('   Response keys:', Object.keys(deployResp).join(', '));

  const unsignedXdr = deployResp.unsignedTransaction;
  console.log('   Got XDR, length:', unsignedXdr.length);

  // Sign it
  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  tx.sign(platformKp);
  const signedXdr = tx.toEnvelope().toXDR('base64');
  console.log('   Signed XDR length:', signedXdr.length);

  console.log('\n2. Submitting via /helper/send-transaction...');
  const sendResp = await twPost('/helper/send-transaction', { signedXdr });
  console.log('   Response keys:', Object.keys(sendResp).join(', '));
  console.log('   FULL RESPONSE:', JSON.stringify(sendResp, null, 2).slice(0, 1000));
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
