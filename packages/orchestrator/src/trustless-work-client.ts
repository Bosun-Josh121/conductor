/**
 * Trustless Work REST API client (server-side).
 *
 * All write actions follow the same pattern:
 *   1. POST to the TW API → receive unsigned XDR
 *   2. Sign the XDR with the appropriate role wallet keypair
 *   3. Submit via the TW API's send-transaction endpoint
 *   4. Return the result
 *
 * Based on the Trustless Work REST API (dev environment):
 *   https://dev.api.trustlesswork.com
 *   Swagger: https://api.trustlesswork.com/docs
 *
 * Testnet network passphrase: "Test SDF Network ; September 2015"
 */

import {
  Keypair,
  TransactionBuilder,
  Networks,
} from '@stellar/stellar-sdk';

const TW_API_URL = process.env.TRUSTLESS_WORK_API_URL || 'https://dev.api.trustlesswork.com';
const TW_API_KEY = process.env.TRUSTLESS_WORK_API_KEY || '';
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET; // "Test SDF Network ; September 2015"

// ── Helper: sign an unsigned XDR with a keypair ────────────────────────────────

export function signXdr(unsignedXdr: string, signerKeypair: Keypair): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, NETWORK_PASSPHRASE);
  tx.sign(signerKeypair);
  return tx.toEnvelope().toXDR('base64');
}

// ── Helper: call TW API ────────────────────────────────────────────────────────

async function twPost(path: string, body: unknown): Promise<any> {
  const url = `${TW_API_URL}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(TW_API_KEY ? { 'Authorization': `Bearer ${TW_API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TW API ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json();
}

async function twGet(path: string): Promise<any> {
  const url = `${TW_API_URL}${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      ...(TW_API_KEY ? { 'Authorization': `Bearer ${TW_API_KEY}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TW API ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json();
}

// ── Helper: submit a signed XDR via TW's send-transaction endpoint ─────────────

async function submitSignedXdr(signedXdr: string): Promise<string> {
  const result = await twPost('/helper/send-transaction', { signedTransaction: signedXdr });
  return result.transactionHash ?? result.hash ?? result.tx_hash ?? '';
}

// ── Submit a signed XDR directly to Horizon (fallback) ────────────────────────

async function submitToHorizon(signedXdr: string): Promise<string> {
  const res = await fetch(`${HORIZON_URL}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `tx=${encodeURIComponent(signedXdr)}`,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Horizon submit failed: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.hash ?? '';
}

// ── Sign + submit helper (tries TW endpoint first, falls back to Horizon) ─────

async function signAndSubmit(unsignedXdr: string, signerKeypair: Keypair): Promise<string> {
  const signedXdr = signXdr(unsignedXdr, signerKeypair);
  try {
    return await submitSignedXdr(signedXdr);
  } catch {
    // Fall back to direct Horizon submission
    return await submitToHorizon(signedXdr);
  }
}

// ── USDC trustline object used in deploy payloads ─────────────────────────────

function usdcTrustline() {
  return {
    address: process.env.USDC_ASSET_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    decimals: parseInt(process.env.USDC_DECIMALS || '7', 10),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface MilestonePayload {
  description: string;   // acceptance criteria live here
  amount: string;        // USDC as string (e.g. "1.00")
}

export interface DeployEscrowSpec {
  title: string;
  description: string;
  platformAddress: string;
  serviceProvider: string;   // specialist agent wallet
  approver: string;          // AI Verifier wallet
  disputeResolver: string;   // AI Arbiter wallet
  releaseSigner: string;     // platform wallet
  receiver: string;          // specialist agent wallet (same as serviceProvider for demo)
  milestones: MilestonePayload[];
  humanOverride?: {
    approver?: string;       // if set, use human wallet as Approver instead
    disputeResolver?: string;
  };
}

export interface DeployResult {
  contractId: string;
  transactionHash: string;
}

/**
 * Deploy a multi-release escrow.
 * The deployer is the platform wallet (signs the deploy transaction).
 */
export async function deployEscrow(
  spec: DeployEscrowSpec,
  platformKeypair: Keypair,
): Promise<DeployResult> {
  const approver = spec.humanOverride?.approver ?? spec.approver;
  const disputeResolver = spec.humanOverride?.disputeResolver ?? spec.disputeResolver;

  const payload = {
    title: spec.title,
    description: spec.description,
    platformAddress: spec.platformAddress,
    serviceProvider: spec.serviceProvider,
    approver,
    disputeResolver,
    releaseSigner: spec.releaseSigner,
    receiver: spec.receiver,
    amount: spec.milestones.reduce((sum, m) => sum + parseFloat(m.amount), 0).toFixed(7),
    trustline: usdcTrustline(),
    milestones: spec.milestones,
    signer: platformKeypair.publicKey(),
  };

  const response = await twPost('/escrow/initiate-escrow', payload);

  const unsignedXdr = response.unsignedTransaction ?? response.xdr ?? response.transaction;
  if (!unsignedXdr) {
    throw new Error(`deployEscrow: no unsigned XDR in response: ${JSON.stringify(response)}`);
  }

  const txHash = await signAndSubmit(unsignedXdr, platformKeypair);

  // The contract ID is returned in the response — it may need a second API call
  const contractId = response.escrowId ?? response.contractId ?? response.contract_id ?? '';

  return { contractId, transactionHash: txHash };
}

/**
 * Fund a deployed escrow. The funder signs this transaction.
 * In the demo path the platform wallet funds it; in production the human funder signs in browser.
 */
export async function fundEscrow(
  contractId: string,
  funderKeypair: Keypair,
  amountUsdc: string,
): Promise<string> {
  const payload = {
    contractId,
    signer: funderKeypair.publicKey(),
    amount: amountUsdc,
  };

  const response = await twPost('/escrow/fund-escrow', payload);
  const unsignedXdr = response.unsignedTransaction ?? response.xdr ?? response.transaction;
  if (!unsignedXdr) {
    throw new Error(`fundEscrow: no unsigned XDR in response: ${JSON.stringify(response)}`);
  }

  return signAndSubmit(unsignedXdr, funderKeypair);
}

/**
 * Mark a milestone as done (Service Provider role).
 * The specialist agent wallet signs.
 */
export async function markMilestone(
  contractId: string,
  milestoneIndex: number,
  evidence: string,
  serviceProviderKeypair: Keypair,
): Promise<string> {
  const payload = {
    contractId,
    milestoneIndex,
    evidence,
    signer: serviceProviderKeypair.publicKey(),
  };

  const response = await twPost('/escrow/change-milestone-status', payload);
  const unsignedXdr = response.unsignedTransaction ?? response.xdr ?? response.transaction;
  if (!unsignedXdr) {
    throw new Error(`markMilestone: no unsigned XDR in response: ${JSON.stringify(response)}`);
  }

  return signAndSubmit(unsignedXdr, serviceProviderKeypair);
}

/**
 * Approve a milestone (Approver role = AI Verifier wallet).
 */
export async function approveMilestone(
  contractId: string,
  milestoneIndex: number,
  approverKeypair: Keypair,
): Promise<string> {
  const payload = {
    contractId,
    milestoneIndex,
    signer: approverKeypair.publicKey(),
  };

  const response = await twPost('/escrow/approve-milestone', payload);
  const unsignedXdr = response.unsignedTransaction ?? response.xdr ?? response.transaction;
  if (!unsignedXdr) {
    throw new Error(`approveMilestone: no unsigned XDR in response: ${JSON.stringify(response)}`);
  }

  return signAndSubmit(unsignedXdr, approverKeypair);
}

/**
 * Release funds for an approved milestone (Release Signer = platform wallet).
 */
export async function releaseMilestone(
  contractId: string,
  milestoneIndex: number,
  releaseSignerKeypair: Keypair,
): Promise<string> {
  const payload = {
    contractId,
    milestoneIndex,
    signer: releaseSignerKeypair.publicKey(),
  };

  const response = await twPost('/escrow/release-milestone', payload);
  const unsignedXdr = response.unsignedTransaction ?? response.xdr ?? response.transaction;
  if (!unsignedXdr) {
    throw new Error(`releaseMilestone: no unsigned XDR in response: ${JSON.stringify(response)}`);
  }

  return signAndSubmit(unsignedXdr, releaseSignerKeypair);
}

/**
 * Start a dispute on a milestone (Service Provider role).
 */
export async function startDispute(
  contractId: string,
  milestoneIndex: number,
  serviceProviderKeypair: Keypair,
): Promise<string> {
  const payload = {
    contractId,
    milestoneIndex,
    signer: serviceProviderKeypair.publicKey(),
  };

  const response = await twPost('/escrow/start-dispute', payload);
  const unsignedXdr = response.unsignedTransaction ?? response.xdr ?? response.transaction;
  if (!unsignedXdr) {
    throw new Error(`startDispute: no unsigned XDR in response: ${JSON.stringify(response)}`);
  }

  return signAndSubmit(unsignedXdr, serviceProviderKeypair);
}

/**
 * Resolve a dispute (Dispute Resolver = AI Arbiter wallet).
 * The Trustless Work resolveDispute is a release/refund decision.
 * agentPercent: percentage going to receiver (0-100); remainder goes back to funder.
 */
export async function resolveDispute(
  contractId: string,
  milestoneIndex: number,
  agentPercent: number,
  arbiterKeypair: Keypair,
): Promise<string> {
  // Clamp to valid range
  const receiverPercent = Math.min(100, Math.max(0, Math.round(agentPercent)));
  const funderPercent = 100 - receiverPercent;

  const payload = {
    contractId,
    milestoneIndex,
    receiverPercent,
    funderPercent,
    signer: arbiterKeypair.publicKey(),
  };

  const response = await twPost('/escrow/resolve-dispute', payload);
  const unsignedXdr = response.unsignedTransaction ?? response.xdr ?? response.transaction;
  if (!unsignedXdr) {
    throw new Error(`resolveDispute: no unsigned XDR in response: ${JSON.stringify(response)}`);
  }

  return signAndSubmit(unsignedXdr, arbiterKeypair);
}

/**
 * Read current on-chain escrow state.
 */
export async function getEscrow(contractId: string): Promise<any> {
  return twGet(`/escrow/get-escrow-by-contract-id?contractId=${encodeURIComponent(contractId)}`);
}

/**
 * Submit a pre-signed XDR (e.g., signed by Freighter in the browser).
 */
export async function submitSignedTransaction(signedXdr: string): Promise<string> {
  return submitSignedXdr(signedXdr);
}
