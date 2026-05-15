/**
 * AI Arbiter — holds the Dispute Resolver role in Trustless Work escrows.
 *
 * When a specialist agent contests a Verifier rejection, the Arbiter weighs
 * both sides and resolves the dispute on-chain with a percentage split.
 *
 * Trustless Work resolveDispute accepts a receiverPercent (0-100):
 *   - 100 = full payment to agent (agent wins)
 *   - 0   = full refund to funder (funder wins)
 *   - 1-99 = split (partial award)
 */

import Anthropic from '@anthropic-ai/sdk';
import { Keypair } from '@stellar/stellar-sdk';
import { resolveDispute } from './trustless-work-client.js';
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
 * Arbitrate a contested milestone rejection.
 * Signs resolveDispute on-chain with the Arbiter wallet.
 */
export async function arbitrateDispute(
  input: ArbiterInput,
  contractId: string,
  milestoneIndex: number,
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

Note: agent_pct + funder_pct must equal 100.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const resolution = parseResolution(text);

  let resolveTxHash: string | null = null;
  try {
    resolveTxHash = await resolveDispute(
      contractId,
      milestoneIndex,
      resolution.agent_pct,
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
