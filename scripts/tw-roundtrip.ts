/**
 * Trustless Work round-trip proof script (Phase 3).
 *
 * Runs the full lifecycle — deploy → fund → (mark → approve → release) × 2 —
 * entirely server-side with no browser or frontend.
 *
 * Prerequisites:
 *   .env with TRUSTLESS_WORK_API_KEY, PLATFORM_SECRET_KEY,
 *   VERIFIER_SECRET_KEY, ARBITER_SECRET_KEY. All wallets funded.
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
  console.log(`Agent    : ${agentKeypair.publicKey()} (platform wallet, for test only)`);
  console.log(`TW API   : ${process.env.TRUSTLESS_WORK_API_URL || 'https://dev.api.trustlesswork.com'}`);
  console.log('');

  // ── 1. Deploy escrow ──────────────────────────────────────────────────────────
  console.log('[1/7] Deploying multi-release escrow with 2 milestones...');
  console.log('      Endpoint: POST /deployer/multi-release');

  const deployResult = await deployEscrow({
    title: 'Conductor Round-Trip Test',
    description: 'Automated proof script: two milestone escrow lifecycle test',
    platformAddress: platformKeypair.publicKey(),
    serviceProvider: agentKeypair.publicKey(),
    approver: verifierKeypair.publicKey(),
    disputeResolver: arbiterKeypair.publicKey(),
    releaseSigner: platformKeypair.publicKey(),
    // receiver is per-milestone in multi-release
    milestones: [
      {
        description: 'Milestone 0: Acceptance criteria: 1) Deliver a hello-world output 2) Output must be non-empty',
        amount: '0.1000000',
        receiver: agentKeypair.publicKey(),
      },
      {
        description: 'Milestone 1: Acceptance criteria: 1) Summarize the test 2) Summary must be at least 10 words',
        amount: '0.1000000',
        receiver: agentKeypair.publicKey(),
      },
    ],
  }, platformKeypair);

  const contractId = deployResult.contractId;
  const viewerUrl  = `${ESCROW_VIEWER_BASE}/${contractId}`;

  console.log(`  ✓ Deployed!`);
  console.log(`  Contract ID : ${contractId}`);
  console.log(`  Deploy TX   : ${deployResult.transactionHash}`);
  console.log(`  Viewer URL  : ${viewerUrl}`);
  await sleep(4000);

  // ── 2. Fund escrow ────────────────────────────────────────────────────────────
  console.log('\n[2/7] Funding escrow with 0.20 USDC...');
  console.log('      Endpoint: POST /escrow/multi-release/fund-escrow');
  const fundTx = await fundEscrow(contractId, platformKeypair, '0.20');
  console.log(`  ✓ Funded! TX: ${fundTx}`);
  await sleep(4000);

  // ── 3. Mark milestone 0 done ──────────────────────────────────────────────────
  console.log('\n[3/7] Marking milestone 0 as done...');
  console.log('      Endpoint: POST /escrow/multi-release/change-milestone-status');
  const mark0Tx = await markMilestone(
    contractId, 0,
    'Hello, world! This is the milestone 0 deliverable. Output is non-empty.',
    agentKeypair,
  );
  console.log(`  ✓ Marked! TX: ${mark0Tx}`);
  await sleep(3000);

  // ── 4. Approve milestone 0 ────────────────────────────────────────────────────
  console.log('\n[4/7] Approving milestone 0 (AI Verifier)...');
  console.log('      Endpoint: POST /escrow/multi-release/approve-milestone');
  const approve0Tx = await approveMilestone(contractId, 0, verifierKeypair);
  console.log(`  ✓ Approved! TX: ${approve0Tx}`);
  await sleep(3000);

  // ── 5. Release milestone 0 ────────────────────────────────────────────────────
  console.log('\n[5/7] Releasing funds for milestone 0...');
  console.log('      Endpoint: POST /escrow/multi-release/release-milestone-funds');
  const release0Tx = await releaseMilestone(contractId, 0, platformKeypair);
  console.log(`  ✓ Released! TX: ${release0Tx}`);
  await sleep(4000);

  // ── 6. Mark + approve + release milestone 1 ───────────────────────────────────
  console.log('\n[6/7] Marking milestone 1 as done...');
  const mark1Tx = await markMilestone(
    contractId, 1,
    'The round-trip test successfully completed two milestones in sequence with automated on-chain signing via Conductor.',
    agentKeypair,
  );
  console.log(`  ✓ Marked! TX: ${mark1Tx}`);
  await sleep(3000);

  console.log('\n[7/7] Approving + releasing milestone 1...');
  const approve1Tx = await approveMilestone(contractId, 1, verifierKeypair);
  console.log(`  ✓ Approved! TX: ${approve1Tx}`);
  await sleep(3000);

  const release1Tx = await releaseMilestone(contractId, 1, platformKeypair);
  console.log(`  ✓ Released! TX: ${release1Tx}`);
  await sleep(4000);

  // ── Read final state ──────────────────────────────────────────────────────────
  console.log('\nReading final on-chain escrow state...');
  let escrowState: any = null;
  try {
    escrowState = await getEscrow(contractId);
    console.log(`  ✓ State fetched`);
  } catch (err: any) {
    console.warn(`  ⚠ Could not fetch state: ${err.message}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
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
    console.log('\nFinal on-chain state (excerpt):');
    console.log(JSON.stringify(escrowState, null, 2).slice(0, 600));
  }

  console.log(`\n✓ Open the Escrow Viewer to verify both milestones show APPROVED + RELEASED:`);
  console.log(`  ${viewerUrl}`);
}

main().catch(err => {
  console.error('\n[FAIL]', err.message);
  if (err.message.includes('401') || err.message.includes('403')) {
    console.error('  → Check TRUSTLESS_WORK_API_KEY in .env');
  }
  if (err.message.includes('no unsigned XDR')) {
    console.error('  → API returned unexpected response format — check endpoint paths');
  }
  process.exit(1);
});
