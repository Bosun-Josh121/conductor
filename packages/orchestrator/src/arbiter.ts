/**
 * AI Arbiter — holds the Dispute Resolver role in Trustless Work escrows.
 *
 * Resolves contested milestone rejections on-chain via:
 *   POST /escrow/multi-release/resolve-milestone-dispute
 *
 * IMPORTANT: Trustless Work resolveDispute uses ABSOLUTE amounts in a
 * `distributions` array — NOT percentages. Each distribution is {address, amount}.
 * The arbiter outputs agent_pct/funder_pct; the caller converts to absolute amounts.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Keypair } from '@stellar/stellar-sdk';
import { resolveDispute, type Distribution } from './trustless-work-client.js';
import type { DisputeResolution, VerifierVerdict } from '@conductor/common';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ArbiterInput {
  milestoneTitle: string;
  acceptanceCriteria: string;
  deliverable: string;
  verifierReasoning: string;
  agentContestReason: string;
  verifierVerdict: VerifierVerdict;
}

export interface ArbiterResult {
  resolution: DisputeResolution;
  resolveTxHash: string | null;
}

/**
 * Arbitrate a contested milestone and resolve on-chain.
 *
 * @param milestoneAmount - Total USDC for this milestone (needed to compute absolute distributions)
 * @param receiverAddress - Agent wallet (gets agent share)
 * @param funderAddress   - Original funder wallet (gets refund share)
 */
export async function arbitrateDispute(
  input: ArbiterInput,
  contractId: string,
  milestoneIndex: number,
  milestoneAmount: number,
  receiverAddress: string,
  funderAddress: string,
  arbiterKeypair: Keypair,
): Promise<ArbiterResult> {
  const prompt = `You are an impartial AI arbiter for a task marketplace dispute. An agent's work was rejected by the AI Verifier; the agent has contested the rejection. You must decide the outcome.

MILESTONE: "${input.milestoneTitle}"

ACCEPTANCE CRITERIA:
${input.acceptanceCriteria}

DELIVERABLE:
${input.deliverable.slice(0, 2000)}

VERIFIER'S REJECTION REASONING:
${input.verifierReasoning}

PER-CRITERION BREAKDOWN:
${JSON.stringify(input.verifierVerdict.per_criterion, null, 2)}

AGENT'S CONTEST ARGUMENT:
${input.agentContestReason}

Weigh both sides fairly. Decide:
- If the agent clearly met the requirements: award 100% to agent
- If the agent clearly failed: award 0% to agent (full refund to funder)
- If partially met: award a fair percentage (e.g., 50%, 70%) to agent

Return ONLY valid JSON (no markdown):
{
  "winner": "agent" | "funder" | "split",
  "reasoning": "Two-paragraph explanation of the decision",
  "agent_pct": 0-100,
  "funder_pct": 0-100
}

agent_pct + funder_pct must equal 100.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const resolution = parseResolution(text);

  // Convert percentages to absolute USDC amounts for the distributions array
  const agentAmount = parseFloat((milestoneAmount * resolution.agent_pct / 100).toFixed(7));
  const funderAmount = parseFloat((milestoneAmount * resolution.funder_pct / 100).toFixed(7));

  const distributions: Distribution[] = [];
  if (resolution.agent_pct > 0) {
    distributions.push({ address: receiverAddress, amount: agentAmount });
  }
  if (resolution.funder_pct > 0) {
    distributions.push({ address: funderAddress, amount: funderAmount });
  }
  // Ensure at least one distribution (TW requires total > 0)
  if (distributions.length === 0) {
    distributions.push({ address: funderAddress, amount: parseFloat(milestoneAmount.toFixed(7)) });
  }

  let resolveTxHash: string | null = null;
  try {
    resolveTxHash = await resolveDispute(
      contractId,
      milestoneIndex,
      distributions,
      arbiterKeypair,
    );
    console.log(`[Arbiter] Resolved dispute on-chain (agent ${resolution.agent_pct}%): ${resolveTxHash}`);
  } catch (err: any) {
    console.error(`[Arbiter] On-chain dispute resolution failed: ${err.message}`);
  }

  return { resolution, resolveTxHash };
}

function parseResolution(text: string): DisputeResolution {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  let raw: any;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      return { winner: 'split', reasoning: 'Arbiter failed to produce a verdict.', agent_pct: 50, funder_pct: 50 };
    }
    raw = JSON.parse(match[0]);
  }

  const agent_pct = Math.min(100, Math.max(0, Math.round(Number(raw.agent_pct) || 0)));
  const funder_pct = 100 - agent_pct;

  let winner: 'agent' | 'funder' | 'split' = 'split';
  if (agent_pct === 100) winner = 'agent';
  else if (agent_pct === 0) winner = 'funder';

  return {
    winner,
    reasoning: String(raw.reasoning || ''),
    agent_pct,
    funder_pct,
  };
}

export function loadArbiterKeypair(): Keypair {
  const secret = process.env.ARBITER_SECRET_KEY;
  if (!secret) throw new Error('ARBITER_SECRET_KEY not set');
  return Keypair.fromSecret(secret);
}
