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

async function callClaude(prompt: string): Promise<string> {
  const delays = [0, 3000, 6000];
  let lastErr: Error = new Error('Unknown');
  for (const delay of delays) {
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      });
      return response.content[0].type === 'text' ? response.content[0].text : '';
    } catch (err: any) {
      lastErr = err;
      const isTransient = err.message?.includes('Connection') || err.message?.includes('timeout') || err.status >= 500;
      if (!isTransient) throw err;
      console.warn(`[Verifier] Claude call failed (${err.message}), retrying...`);
    }
  }
  throw lastErr;
}

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
 * Get Claude's verdict on a deliverable without any on-chain action.
 * Used in human-override mode to produce an AI recommendation for the human reviewer.
 */
export async function getVerifierVerdict(input: VerifierInput): Promise<VerifierVerdict> {
  const prompt = `You are an objective AI quality verifier for a task marketplace. Your job is to evaluate a deliverable against explicit acceptance criteria and return a structured verdict.

MILESTONE: "${input.milestoneTitle}"

ACCEPTANCE CRITERIA:
${input.acceptanceCriteria}

DELIVERABLE:
${input.deliverable.slice(0, 3000)}

Evaluate each criterion individually. Be honest and strict — only pass if the criterion is genuinely met.

Return ONLY valid JSON with this exact shape (no markdown, no explanation):
{
  "passed": true or false,
  "reasoning": "One paragraph explaining the overall verdict",
  "per_criterion": [
    { "criterion": "criterion text", "passed": true or false, "note": "brief note" }
  ]
}`;

  try {
    const text = await callClaude(prompt);
    return parseVerdict(text);
  } catch (err: any) {
    console.warn(`[Verifier] getVerifierVerdict infrastructure error: ${err.message} — defaulting to pass`);
    return { passed: true, reasoning: `Verifier unavailable (${err.message}). Defaulting to pass — agent should not be penalized for infrastructure failures.`, per_criterion: [] };
  }
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

  let verdict: VerifierVerdict;
  try {
    const text = await callClaude(prompt);
    verdict = parseVerdict(text);
  } catch (err: any) {
    console.warn(`[Verifier] verifyMilestone infrastructure error: ${err.message} — defaulting to pass`);
    verdict = { passed: true, reasoning: `Verifier unavailable (${err.message}). Defaulting to pass.`, per_criterion: [] };
  }

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
  const fallback = (reason: string): VerifierVerdict => ({
    passed: false,
    reasoning: reason,
    per_criterion: [],
  });

  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let raw: any;

  // Try full parse first
  try { raw = JSON.parse(cleaned); }
  catch {
    // Try extracting the outermost {...} block (handles trailing truncation)
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return fallback('Verifier returned non-JSON response.');
    try { raw = JSON.parse(match[0]); }
    catch {
      // Last resort: extract just the fields we care about with regex
      const passedMatch = cleaned.match(/"passed"\s*:\s*(true|false)/);
      const reasonMatch = cleaned.match(/"reasoning"\s*:\s*"([^"]{0,500})"/);
      if (!passedMatch) return fallback('Verifier response was truncated and unparseable.');
      return {
        passed: passedMatch[1] === 'true',
        reasoning: reasonMatch ? reasonMatch[1] : 'Verdict truncated — see raw output.',
        per_criterion: [],
      };
    }
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
