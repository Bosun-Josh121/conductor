/**
 * AI Verifier — holds the Approver role in Trustless Work escrows.
 *
 * Evaluates deliverables against milestone acceptance criteria and signs
 * on-chain approval only when the deliverable passes.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Keypair } from '@stellar/stellar-sdk';
import { approveMilestone } from './trustless-work-client.js';
import type { VerifierVerdict } from '@conductor/common';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface VerifierInput {
  acceptanceCriteria: string;
  deliverable: string;
  milestoneTitle: string;
}

export interface VerifierResult {
  verdict: VerifierVerdict;
  approvalTxHash: string | null;  // non-null only if passed=true and contract signed
}

/**
 * Evaluate a deliverable against acceptance criteria.
 * If passed, signs the on-chain milestone approval with the Verifier wallet.
 */
export async function verifyMilestone(
  input: VerifierInput,
  contractId: string,
  milestoneIndex: number,
  verifierKeypair: Keypair,
): Promise<VerifierResult> {
  const prompt = `You are an objective AI quality verifier for a task marketplace. Your job is to evaluate a deliverable against explicit acceptance criteria and return a structured verdict.

MILESTONE: "${input.milestoneTitle}"

ACCEPTANCE CRITERIA:
${input.acceptanceCriteria}

DELIVERABLE:
${input.deliverable.slice(0, 3000)}

Evaluate each criterion individually. Be honest and strict — only pass if the criterion is genuinely met. A vague or incomplete deliverable should FAIL.

Return ONLY valid JSON with this exact shape (no markdown, no explanation):
{
  "passed": true or false,
  "reasoning": "One paragraph explaining the overall verdict",
  "per_criterion": [
    {
      "criterion": "criterion text",
      "passed": true or false,
      "note": "brief note on why"
    }
  ]
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const verdict = parseVerdict(text);

  let approvalTxHash: string | null = null;

  if (verdict.passed) {
    try {
      approvalTxHash = await approveMilestone(contractId, milestoneIndex, verifierKeypair);
      console.log(`[Verifier] Approved milestone ${milestoneIndex} on-chain: ${approvalTxHash}`);
    } catch (err: any) {
      console.error(`[Verifier] On-chain approval failed: ${err.message}`);
      // Return the verdict but mark approval as failed — caller handles retry/dispute
    }
  } else {
    console.log(`[Verifier] Rejected milestone ${milestoneIndex}: ${verdict.reasoning}`);
  }

  return { verdict, approvalTxHash };
}

function parseVerdict(text: string): VerifierVerdict {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  let raw: any;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        passed: false,
        reasoning: 'Verifier failed to produce a structured verdict.',
        per_criterion: [],
      };
    }
    raw = JSON.parse(match[0]);
  }

  return {
    passed: Boolean(raw.passed),
    reasoning: String(raw.reasoning || ''),
    per_criterion: Array.isArray(raw.per_criterion)
      ? raw.per_criterion.map((c: any) => ({
          criterion: String(c.criterion || ''),
          passed: Boolean(c.passed),
          note: String(c.note || ''),
        }))
      : [],
  };
}

/**
 * Load the Verifier keypair from env.
 */
export function loadVerifierKeypair(): Keypair {
  const secret = process.env.VERIFIER_SECRET_KEY;
  if (!secret) throw new Error('VERIFIER_SECRET_KEY not set');
  return Keypair.fromSecret(secret);
}
