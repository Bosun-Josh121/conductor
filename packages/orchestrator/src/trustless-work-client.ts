/**
 * Trustless Work REST API client (server-side).
 *
 * All write actions: POST to TW API → receive unsigned XDR → sign server-side → submit.
 *
 * Verified endpoints (source: docs.trustlesswork.com api-rest/* pages, May 2026):
 *   Base URL (testnet): https://dev.api.trustlesswork.com
 *   Auth header: x-api-key
 *   Submit: POST /helper/send-transaction  { signedXdr: string }
 *
 * Multi-release endpoints confirmed:
 *   POST /deployer/multi-release                           — deploy
 *   POST /escrow/multi-release/fund-escrow                 — fund
 *   POST /escrow/multi-release/change-milestone-status     — mark done
 *   POST /escrow/multi-release/approve-milestone           — approve
 *   POST /escrow/multi-release/release-milestone-funds     — release
 *   POST /escrow/multi-release/dispute-milestone           — start dispute
 *   POST /escrow/multi-release/resolve-milestone-dispute   — resolve dispute
 */

import {
  Keypair,
  TransactionBuilder,
  Networks,
} from '@stellar/stellar-sdk';
import { v4 as uuidv4 } from 'uuid';

const TW_API_URL = process.env.TRUSTLESS_WORK_API_URL || 'https://dev.api.trustlesswork.com';
const TW_API_KEY = process.env.TRUSTLESS_WORK_API_KEY || '';
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET; // "Test SDF Network ; September 2015"

// ── Signing helper ─────────────────────────────────────────────────────────────

export function signXdr(unsignedXdr: string, signerKeypair: Keypair): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, NETWORK_PASSPHRASE);
  tx.sign(signerKeypair);
  return tx.toEnvelope().toXDR('base64');
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (TW_API_KEY) h['x-api-key'] = TW_API_KEY;
  return h;
}

async function twPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${TW_API_URL}${path}`, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TW API ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

async function twGet(path: string): Promise<any> {
  const res = await fetch(`${TW_API_URL}${path}`, {
    method: 'GET',
    headers: buildHeaders(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TW API ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

// ── Submit signed XDR via TW endpoint, with Horizon fallback ──────────────────

async function submitToTW(signedXdr: string): Promise<string> {
  // Confirmed field name: signedXdr (docs.trustlesswork.com/api-rest/helpers/send-transaction)
  const result = await twPost('/helper/send-transaction', { signedXdr });
  return result.transactionHash ?? result.hash ?? result.tx_hash ?? '';
}

async function submitToHorizon(signedXdr: string): Promise<string> {
  const res = await fetch(`${HORIZON_URL}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `tx=${encodeURIComponent(signedXdr)}`,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Horizon submit: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.hash ?? '';
}

async function signAndSubmit(unsignedXdr: string, signerKeypair: Keypair): Promise<string> {
  const signedXdr = signXdr(unsignedXdr, signerKeypair);
  try {
    return await submitToTW(signedXdr);
  } catch (err: any) {
    console.warn(`[TW] /helper/send-transaction failed (${err.message}), falling back to Horizon`);
    return await submitToHorizon(signedXdr);
  }
}

function extractUnsignedXdr(response: any, op: string): string {
  // Confirmed response field: unsignedTransaction (docs.trustlesswork.com/escrow-react-sdk)
  const xdr = response.unsignedTransaction ?? response.xdr ?? response.transaction;
  if (!xdr) throw new Error(`${op}: no unsigned XDR in response: ${JSON.stringify(response).slice(0, 200)}`);
  return xdr;
}

// ── USDC trustline helper ──────────────────────────────────────────────────────

function usdcTrustline() {
  return {
    address: process.env.USDC_ASSET_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    // Confirmed field name: symbol (not decimals)
    symbol: process.env.USDC_ASSET_CODE || 'USDC',
  };
}

// ── Public types ───────────────────────────────────────────────────────────────

export interface MilestonePayload {
  description: string;
  amount: string;       // USDC as decimal string e.g. "1.0000000"
  receiver: string;     // per-milestone receiver address (confirmed: multi-release has receiver per milestone)
}

export interface DeployEscrowSpec {
  title: string;
  description: string;
  platformAddress: string;
  serviceProvider: string;
  approver: string;
  disputeResolver: string;
  releaseSigner: string;
  milestones: MilestonePayload[];
  humanOverride?: {
    approver?: string;
    disputeResolver?: string;
  };
}

export interface DeployResult {
  contractId: string;
  transactionHash: string;
}

export interface Distribution {
  address: string;
  amount: string;   // absolute USDC amount as decimal string
}

// ── Deploy multi-release escrow ────────────────────────────────────────────────

export async function deployEscrow(
  spec: DeployEscrowSpec,
  platformKeypair: Keypair,
): Promise<DeployResult> {
  const approver    = spec.humanOverride?.approver       ?? spec.approver;
  const disputeResolver = spec.humanOverride?.disputeResolver ?? spec.disputeResolver;

  // Confirmed payload structure for POST /deployer/multi-release
  // roles is a nested object; trustline uses symbol not decimals; no top-level amount/receiver
  const payload = {
    signer: platformKeypair.publicKey(),
    engagementId: uuidv4(),           // required unique identifier
    title: spec.title,
    description: spec.description,
    roles: {
      approver,
      serviceProvider: spec.serviceProvider,
      platformAddress: spec.platformAddress,
      releaseSigner: spec.releaseSigner,
      disputeResolver,
    },
    platformFee: 0,
    milestones: spec.milestones.map(m => ({
      description: m.description,
      amount: m.amount,
      receiver: m.receiver,
    })),
    trustline: usdcTrustline(),
  };

  const response = await twPost('/deployer/multi-release', payload);
  const unsignedXdr = extractUnsignedXdr(response, 'deployEscrow');
  const txHash = await signAndSubmit(unsignedXdr, platformKeypair);

  // Confirmed response field: contractId
  const contractId = response.contractId ?? response.escrowId ?? response.contract_id ?? '';

  return { contractId, transactionHash: txHash };
}

// ── Fund escrow ────────────────────────────────────────────────────────────────

export async function fundEscrow(
  contractId: string,
  funderKeypair: Keypair,
  amountUsdc: string,
): Promise<string> {
  const response = await twPost('/escrow/multi-release/fund-escrow', {
    contractId,
    signer: funderKeypair.publicKey(),
    amount: parseFloat(amountUsdc),  // confirmed: amount is a number
  });
  return signAndSubmit(extractUnsignedXdr(response, 'fundEscrow'), funderKeypair);
}

// ── Mark milestone done (Service Provider signs) ───────────────────────────────

export async function markMilestone(
  contractId: string,
  milestoneIndex: number,
  evidence: string,
  serviceProviderKeypair: Keypair,
): Promise<string> {
  // Confirmed: POST /escrow/multi-release/change-milestone-status
  // Fields: contractId, milestoneIndex (string), newStatus (string),
  //         newEvidence (string), serviceProvider (address)
  const response = await twPost('/escrow/multi-release/change-milestone-status', {
    contractId,
    milestoneIndex: String(milestoneIndex),
    newStatus: 'completed',
    newEvidence: evidence.slice(0, 500),
    serviceProvider: serviceProviderKeypair.publicKey(),
  });
  return signAndSubmit(extractUnsignedXdr(response, 'markMilestone'), serviceProviderKeypair);
}

// ── Approve milestone (Approver / AI Verifier signs) ──────────────────────────

export async function approveMilestone(
  contractId: string,
  milestoneIndex: number,
  approverKeypair: Keypair,
): Promise<string> {
  // Confirmed: POST /escrow/multi-release/approve-milestone
  // Fields: contractId, milestoneIndex (string), approver (address)
  const response = await twPost('/escrow/multi-release/approve-milestone', {
    contractId,
    milestoneIndex: String(milestoneIndex),
    approver: approverKeypair.publicKey(),
  });
  return signAndSubmit(extractUnsignedXdr(response, 'approveMilestone'), approverKeypair);
}

// ── Release milestone funds (Release Signer / Platform signs) ─────────────────

export async function releaseMilestone(
  contractId: string,
  milestoneIndex: number,
  releaseSignerKeypair: Keypair,
): Promise<string> {
  // Confirmed: POST /escrow/multi-release/release-milestone-funds
  // Fields: contractId, releaseSigner (address), milestoneIndex (string)
  const response = await twPost('/escrow/multi-release/release-milestone-funds', {
    contractId,
    milestoneIndex: String(milestoneIndex),
    releaseSigner: releaseSignerKeypair.publicKey(),
  });
  return signAndSubmit(extractUnsignedXdr(response, 'releaseMilestone'), releaseSignerKeypair);
}

// ── Start dispute (Service Provider signs) ────────────────────────────────────

export async function startDispute(
  contractId: string,
  milestoneIndex: number,
  serviceProviderKeypair: Keypair,
): Promise<string> {
  // Confirmed: POST /escrow/multi-release/dispute-milestone
  // Fields: contractId, milestoneIndex (string), signer (address)
  const response = await twPost('/escrow/multi-release/dispute-milestone', {
    contractId,
    milestoneIndex: String(milestoneIndex),
    signer: serviceProviderKeypair.publicKey(),
  });
  return signAndSubmit(extractUnsignedXdr(response, 'startDispute'), serviceProviderKeypair);
}

// ── Resolve dispute (Dispute Resolver / AI Arbiter signs) ─────────────────────

export async function resolveDispute(
  contractId: string,
  milestoneIndex: number,
  distributions: Distribution[],  // absolute amounts, NOT percentages
  arbiterKeypair: Keypair,
): Promise<string> {
  // Confirmed: POST /escrow/multi-release/resolve-milestone-dispute
  // Fields: contractId, disputeResolver (address), milestoneIndex (string),
  //         distributions [{address, amount}] — amounts MUST be absolute, not percentages
  const response = await twPost('/escrow/multi-release/resolve-milestone-dispute', {
    contractId,
    milestoneIndex: String(milestoneIndex),
    disputeResolver: arbiterKeypair.publicKey(),
    distributions,
  });
  return signAndSubmit(extractUnsignedXdr(response, 'resolveDispute'), arbiterKeypair);
}

// ── Read escrow state ──────────────────────────────────────────────────────────

export async function getEscrow(contractId: string): Promise<any> {
  // Try indexer endpoint first, then direct escrow endpoint
  try {
    return await twGet(`/escrow/${encodeURIComponent(contractId)}`);
  } catch {
    try {
      return await twGet(`/indexer/get-escrows-by-contract-ids?contractIds=${encodeURIComponent(contractId)}`);
    } catch {
      return await twGet(`/escrow/get-escrow-by-contract-id?contractId=${encodeURIComponent(contractId)}`);
    }
  }
}

// ── Submit a pre-signed XDR (from Freighter) ──────────────────────────────────

export async function submitSignedTransaction(signedXdr: string): Promise<string> {
  try {
    return await submitToTW(signedXdr);
  } catch {
    return await submitToHorizon(signedXdr);
  }
}
