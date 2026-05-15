/**
 * Trustless Work round-trip proof script (Phase 3).
 *
 * Runs the full lifecycle — deploy → fund → (mark → approve → release) × 2 —
 * entirely server-side with no browser or frontend.
 *
 * Prerequisites:
 *   1. .env loaded with TRUSTLESS_WORK_API_KEY, PLATFORM_SECRET_KEY,
 *      VERIFIER_SECRET_KEY, ARBITER_SECRET_KEY, and at least one agent wallet.
 *   2. All wallets funded with testnet XLM and USDC.
 *
 * Run: npx tsx scripts/tw-roundtrip.ts
 */

import 'dotenv/config';
import { Keypair } from '@stellar/stellar-sdk';
import {
  deployEscrow,
  fundEscrow,
  markMilestone,
  approveMilestone,
  releaseMilestone,
  getEscrow,
} from '../packages/orchestrator/src/trustless-work-client.js';

const ESCROW_VIEWER_BASE = 'https://viewer.trustlesswork.com';

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('='.repeat(60));
  console.log('Conductor — Trustless Work Round-Trip Proof');
  console.log('='.repeat(60));

  const platformKeypair = Keypair.fromSecret(requireEnv('PLATFORM_SECRET_KEY'));
  const verifierKeypair = Keypair.fromSecret(requireEnv('VERIFIER_SECRET_KEY'));
  const arbiterKeypair  = Keypair.fromSecret(requireEnv('ARBITER_SECRET_KEY'));

  // Use platform as agent for this standalone test
  const agentKeypair = platformKeypair;

  console.log(`\nPlatform : ${platformKeypair.publicKey()}`);
  console.log(`Verifier : ${verifierKeypair.publicKey()}`);
  console.log(`Arbiter  : ${arbiterKeypair.publicKey()}`);
  console.log(`Agent    : ${agentKeypair.publicKey()} (using platform wallet for test)`);
  console.log('');

  // ── 1. Deploy escrow ────────────────────────────────────────────────────────
  console.log('[1/7] Deploying multi-release escrow with 2 milestones...');

  const deployResult = await deployEscrow({
    title: 'Conductor Round-Trip Test',
    description: 'Automated proof script: two milestone escrow lifecycle test',
    platformAddress: platformKeypair.publicKey(),
    serviceProvider: agentKeypair.publicKey(),
    approver: verifierKeypair.publicKey(),
    disputeResolver: arbiterKeypair.publicKey(),
    releaseSigner: platformKeypair.publicKey(),
    receiver: agentKeypair.publicKey(),
    milestones: [
      {
        description: 'Milestone 0: Acceptance criteria: 1) Deliver a hello-world output 2) Output must be non-empty',
        amount: '0.10',
      },
      {
        description: 'Milestone 1: Acceptance criteria: 1) Summarize the test 2) Summary must be at least 10 words',
        amount: '0.10',
      },
    ],
  }, platformKeypair);

  const contractId = deployResult.contractId;
  const viewerUrl  = `${ESCROW_VIEWER_BASE}/${contractId}`;

  console.log(`  ✓ Deployed!`);
  console.log(`  Contract ID : ${contractId}`);
  console.log(`  Deploy TX   : ${deployResult.transactionHash}`);
  console.log(`  Viewer URL  : ${viewerUrl}`);
  await sleep(3000);

  // ── 2. Fund escrow ──────────────────────────────────────────────────────────
  console.log('\n[2/7] Funding escrow with 0.20 USDC...');
  const fundTx = await fundEscrow(contractId, platformKeypair, '0.20');
  console.log(`  ✓ Funded! TX: ${fundTx}`);
  await sleep(3000);

  // ── 3. Mark milestone 0 done ────────────────────────────────────────────────
  console.log('\n[3/7] Marking milestone 0 as done (agent)...');
  const mark0Tx = await markMilestone(contractId, 0, 'Hello, world! Milestone 0 deliverable.', agentKeypair);
  console.log(`  ✓ Marked! TX: ${mark0Tx}`);
  await sleep(2000);

  // ── 4. Approve milestone 0 ──────────────────────────────────────────────────
  console.log('\n[4/7] Approving milestone 0 (AI Verifier)...');
  const approve0Tx = await approveMilestone(contractId, 0, verifierKeypair);
  console.log(`  ✓ Approved! TX: ${approve0Tx}`);
  await sleep(2000);

  // ── 5. Release milestone 0 ──────────────────────────────────────────────────
  console.log('\n[5/7] Releasing funds for milestone 0 (platform)...');
  const release0Tx = await releaseMilestone(contractId, 0, platformKeypair);
  console.log(`  ✓ Released! TX: ${release0Tx}`);
  await sleep(3000);

  // ── 6. Mark + approve + release milestone 1 ────────────────────────────────
  console.log('\n[6/7] Marking milestone 1 as done (agent)...');
  const mark1Tx = await markMilestone(
    contractId, 1,
    'The round-trip test successfully completed two milestones in sequence with automated signing.',
    agentKeypair,
  );
  console.log(`  ✓ Marked! TX: ${mark1Tx}`);
  await sleep(2000);

  console.log('\n[7/7] Approving + releasing milestone 1...');
  const approve1Tx = await approveMilestone(contractId, 1, verifierKeypair);
  console.log(`  ✓ Approved! TX: ${approve1Tx}`);
  await sleep(2000);

  const release1Tx = await releaseMilestone(contractId, 1, platformKeypair);
  console.log(`  ✓ Released! TX: ${release1Tx}`);
  await sleep(3000);

  // ── 7. Read final state ─────────────────────────────────────────────────────
  console.log('\nReading final escrow state from chain...');
  let escrowState: any = null;
  try {
    escrowState = await getEscrow(contractId);
  } catch (err: any) {
    console.warn(`  ⚠ Could not read final state: ${err.message}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('ROUND-TRIP COMPLETE ✓');
  console.log('='.repeat(60));
  console.log(`\nEscrow Contract ID : ${contractId}`);
  console.log(`Escrow Viewer URL  : ${viewerUrl}`);
  console.log('\nTransaction hashes:');
  console.log(`  Deploy      : ${deployResult.transactionHash}`);
  console.log(`  Fund        : ${fundTx}`);
  console.log(`  Mark 0      : ${mark0Tx}`);
  console.log(`  Approve 0   : ${approve0Tx}`);
  console.log(`  Release 0   : ${release0Tx}`);
  console.log(`  Mark 1      : ${mark1Tx}`);
  console.log(`  Approve 1   : ${approve1Tx}`);
  console.log(`  Release 1   : ${release1Tx}`);

  if (escrowState) {
    console.log('\nFinal on-chain state:');
    console.log(JSON.stringify(escrowState, null, 2).slice(0, 800));
  }

  console.log('\n✓ Open the Escrow Viewer URL above to verify both milestones show APPROVED + RELEASED');
}

main().catch(err => {
  console.error('\n[FAIL]', err.message);
  process.exit(1);
});
