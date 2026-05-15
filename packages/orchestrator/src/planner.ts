import Anthropic from '@anthropic-ai/sdk';
import type { AgentRecord, ExecutionPlan, MilestoneSpec } from '@conductor/common';
import { scoreAgents } from './selector.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CONTEXT = `
You are orchestrating AI agents as a task marketplace where each milestone is backed by a Trustless Work escrow.
Each milestone must have explicit, checkable acceptance criteria — the AI Verifier will evaluate deliverables against these criteria to decide whether to approve on-chain payment.
`;

export async function createPlan(
  task: string,
  availableAgents: AgentRecord[],
  budget: number,
): Promise<ExecutionPlan> {
  const scored = scoreAgents(availableAgents, [], budget / Math.max(1, availableAgents.length));
  const rankMap = new Map(scored.map((s, i) => [s.agent.agent_id, i + 1]));

  const agentList = scored.map(s => ({
    agent_id: s.agent.agent_id,
    name: s.agent.name,
    description: s.agent.description,
    capabilities: s.agent.capabilities,
    price_per_call: s.agent.pricing.price_per_call,
    reputation_score: s.agent.reputation?.score ?? 50,
    selection_rank: rankMap.get(s.agent.agent_id) ?? 99,
  }));

  const prompt = `${CONTEXT}

You are a task planner. Decompose the user's task into an ordered sequence of milestones.

AVAILABLE AGENTS:
${JSON.stringify(agentList, null, 2)}

TASK: "${task}"
BUDGET: $${budget} USDC total

RULES:
1. Only use agent_ids from the list above — NEVER invent agent_ids.
2. Use the FEWEST milestones necessary (2-4 for most tasks).
3. Each milestone must be assigned to ONE agent (the same agent handles all milestones in the demo path — pick the best overall agent).
4. The sum of all milestone amounts must not exceed the budget.
5. Every milestone MUST have explicit, checkable acceptance criteria in the "description" field. The Verifier AI will check these — vague criteria cause failures.
6. Return ONLY valid JSON — no markdown fences, no explanation.

Return a JSON object with this exact shape:
{
  "milestones": [
    {
      "title": "Short milestone name",
      "description": "Acceptance criteria: 1) ... 2) ... 3) ... (be specific and checkable)",
      "amount": 0.10,
      "capabilityTags": ["tag1", "tag2"]
    }
  ],
  "total_estimated_cost": 0.20,
  "reasoning": "One sentence explaining the plan",
  "selected_agent_id": "<best agent_id for this task>"
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return parsePlan(text, availableAgents, budget);
}

function parsePlan(text: string, agents: AgentRecord[], budget: number): ExecutionPlan {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let raw: any;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Planner returned non-JSON response');
    raw = JSON.parse(match[0]);
  }

  if (!Array.isArray(raw.milestones) || raw.milestones.length === 0) {
    throw new Error('Planner returned no milestones');
  }

  const agentIds = new Set(agents.map(a => a.agent_id));

  if (raw.selected_agent_id && !agentIds.has(raw.selected_agent_id)) {
    throw new Error(`Planner selected unknown agent_id: ${raw.selected_agent_id}`);
  }

  const milestones: MilestoneSpec[] = raw.milestones.map((m: any) => ({
    title: String(m.title || 'Milestone'),
    description: String(m.description || ''),
    amount: Number(m.amount) || 0,
    capabilityTags: Array.isArray(m.capabilityTags) ? m.capabilityTags : [],
  }));

  // Validate acceptance criteria
  for (const m of milestones) {
    if (!m.description.trim()) {
      throw new Error(`Milestone "${m.title}" has no acceptance criteria`);
    }
  }

  // Validate budget
  const total = milestones.reduce((s, m) => s + m.amount, 0);
  if (total > budget * 1.01) {
    throw new Error(`Plan cost $${total.toFixed(4)} exceeds budget $${budget.toFixed(4)}`);
  }

  return {
    milestones,
    total_estimated_cost: raw.total_estimated_cost ?? total,
    reasoning: raw.reasoning ?? '',
    selected_agent_id: raw.selected_agent_id ?? null,
  };
}

/**
 * Convert a plan + role wallet addresses into the escrow deploy spec.
 */
export function planToEscrowSpec(
  plan: ExecutionPlan,
  task: string,
  roles: {
    platformAddress: string;
    serviceProvider: string;
    approver: string;
    disputeResolver: string;
    releaseSigner: string;
    receiver: string;
    humanOverride?: { approver?: string; disputeResolver?: string };
  },
) {
  return {
    title: task.slice(0, 100),
    description: task,
    platformAddress: roles.platformAddress,
    serviceProvider: roles.serviceProvider,
    approver: roles.approver,
    disputeResolver: roles.disputeResolver,
    releaseSigner: roles.releaseSigner,
    receiver: roles.receiver,
    humanOverride: roles.humanOverride,
    milestones: plan.milestones.map(m => ({
      description: `${m.title}: ${m.description}`,
      amount: m.amount.toFixed(7),
    })),
  };
}
