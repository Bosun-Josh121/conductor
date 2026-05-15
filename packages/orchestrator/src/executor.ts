/**
 * Conductor Execution Engine
 *
 * Key design:
 * - Platform wallet is the escrow ServiceProvider (signs markMilestone calls)
 * - DIFFERENT agent selected per milestone based on capabilityTags
 * - Each milestone's receiver = the selected agent's stellar address
 * - All AI-signed actions use server-side keypairs
 */

import { EventEmitter } from 'events';
import { Keypair } from '@stellar/stellar-sdk';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentRecord,
  ExecutionPlan,
  MilestoneResult,
  TaskResult,
} from '@conductor/common';
import { escrowViewerUrl, txExplorerUrl } from '@conductor/common';
import {
  deployEscrow,
  fundEscrow,
  markMilestone,
  releaseMilestone,
  startDispute,
  type DeployEscrowSpec,
} from './trustless-work-client.js';
import { verifyMilestone, loadVerifierKeypair } from './verifier.js';
import { arbitrateDispute, loadArbiterKeypair } from './arbiter.js';
import { planToEscrowSpec } from './planner.js';
import { selectBestAgent, scoreAgents } from './selector.js';

export interface ExecutorOptions {
  contractId?: string;
  humanOverride?: {
    approver?: string;
    disputeResolver?: string;
  };
}

// ── Health check ──────────────────────────────────────────────────────────────

async function checkHealth(agent: AgentRecord): Promise<boolean> {
  const delays = [0, 5000, 10000, 10000, 10000];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise(r => setTimeout(r, delays[i]));
    try {
      const res = await fetch(agent.health_check, { signal: AbortSignal.timeout(12000) });
      if (res.ok) return true;
      if (res.status !== 503 && res.status !== 502) return false;
    } catch { /* retry */ }
  }
  return false;
}

// ── Agent call ────────────────────────────────────────────────────────────────

async function callAgent(agent: AgentRecord, action: string, context?: string): Promise<string> {
  const body: Record<string, string> = { instruction: action };
  if (context) body.context = context;

  const res = await fetch(agent.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Agent ${agent.name} returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return String(data.result ?? data.output ?? data.text ?? JSON.stringify(data));
}

// ── PlanExecutor ──────────────────────────────────────────────────────────────

export class PlanExecutor extends EventEmitter {
  private agentMap: Map<string, AgentRecord>;
  private platformKeypair: Keypair;
  private verifierKeypair: Keypair;
  private arbiterKeypair: Keypair;

  constructor(availableAgents: AgentRecord[]) {
    super();
    this.agentMap = new Map(availableAgents.map(a => [a.agent_id, a]));
    this.platformKeypair = Keypair.fromSecret(process.env.PLATFORM_SECRET_KEY!);
    this.verifierKeypair = loadVerifierKeypair();
    this.arbiterKeypair = loadArbiterKeypair();
  }

  async execute(
    plan: ExecutionPlan,
    task: string,
    registryUrl: string,
    userAddress: string | null,
    options: ExecutorOptions = {},
  ): Promise<TaskResult> {
    const task_id = uuidv4();
    const startTime = Date.now();
    const agents = [...this.agentMap.values()];

    this.emit('task_started', { task_id, task, milestone_count: plan.milestones.length });

    // ── Select best agent PER MILESTONE based on capabilityTags ──────────────
    // Platform wallet is the escrow serviceProvider (signs mark transactions).
    // Each milestone routes to the most capable registered agent.
    const milestoneAgents: AgentRecord[] = plan.milestones.map(m => {
      if (m.capabilityTags.length > 0) {
        const best = selectBestAgent(agents, m.capabilityTags);
        if (best) return best.agent;
      }
      // Fallback: pick highest-reputation agent
      return agents.sort((a, b) => b.reputation.score - a.reputation.score)[0];
    });

    // Log the routing decision
    for (let i = 0; i < plan.milestones.length; i++) {
      const a = milestoneAgents[i];
      console.log(`[Executor] M${i} "${plan.milestones[i].title}" → ${a?.name ?? '?'} (caps: ${plan.milestones[i].capabilityTags.join(',')})`);
    }

    // ── Deploy escrow ─────────────────────────────────────────────────────────
    // Platform is the serviceProvider (signs marks); per-milestone receiver = agent address
    let contractId = options.contractId ?? '';
    let deployTxHash = '';

    if (!contractId) {
      this.emit('escrow_deploying', { task_id, milestone_count: plan.milestones.length });

      const escrowSpec: DeployEscrowSpec = {
        title: task.slice(0, 100),
        description: task,
        platformAddress: this.platformKeypair.publicKey(),
        serviceProvider: this.platformKeypair.publicKey(),  // platform signs all marks
        approver: options.humanOverride?.approver ?? this.verifierKeypair.publicKey(),
        disputeResolver: options.humanOverride?.disputeResolver ?? this.arbiterKeypair.publicKey(),
        releaseSigner: this.platformKeypair.publicKey(),
        humanOverride: options.humanOverride,
        milestones: plan.milestones.map((m, i) => ({
          description: `${m.title}: ${m.description}`,
          amount: m.amount.toFixed(7),
          receiver: milestoneAgents[i]?.stellar_address ?? this.platformKeypair.publicKey(),
        })),
      };

      const deployResult = await deployEscrow(escrowSpec, this.platformKeypair);
      contractId = deployResult.contractId;
      deployTxHash = deployResult.transactionHash;

      this.emit('escrow_deployed', {
        task_id,
        contract_id: contractId,
        tx_hash: deployTxHash,
        viewer_url: escrowViewerUrl(contractId),
      });
    }

    // ── Auto-fund ─────────────────────────────────────────────────────────────
    const totalUsdc = plan.milestones.reduce((s, m) => s + m.amount, 0);
    try {
      const fundTx = await fundEscrow(contractId, this.platformKeypair, totalUsdc.toFixed(7));
      this.emit('escrow_funded', { task_id, contract_id: contractId, tx_hash: fundTx, amount_usdc: totalUsdc });
      console.log(`[Executor] Escrow ${contractId.slice(0, 8)} funded: ${totalUsdc.toFixed(4)} USDC`);
    } catch (err: any) {
      console.warn(`[Executor] Auto-fund failed: ${err.message}`);
      this.emit('funding_required', { task_id, contract_id: contractId, viewer_url: escrowViewerUrl(contractId), total_usdc: totalUsdc });
    }

    // ── Execute milestones ────────────────────────────────────────────────────
    const milestoneResults: MilestoneResult[] = [];
    let previousOutput: string | null = null;
    let totalCost = 0;

    for (let i = 0; i < plan.milestones.length; i++) {
      const milestone = plan.milestones[i];
      const msStart = Date.now();
      const agent = milestoneAgents[i];

      if (!agent) {
        milestoneResults.push(this.failedMilestone(i, milestone.title, { agent_id: '?', name: 'unknown' } as AgentRecord, 'No agent selected', msStart));
        continue;
      }

      this.emit('milestone_started', { task_id, milestone_index: i, title: milestone.title, agent: agent.name });

      // Health check
      const healthy = await checkHealth(agent);
      if (!healthy) {
        milestoneResults.push(this.failedMilestone(i, milestone.title, agent, 'Agent health check failed', msStart));
        this.emit('milestone_failed', { task_id, milestone_index: i, error: 'Agent health check failed' });
        continue;
      }

      // Agent does the work
      let output: string | null = null;
      try {
        output = await callAgent(agent, `${milestone.title}: ${milestone.description}`, previousOutput ?? undefined);
        this.emit('agent_output', { task_id, milestone_index: i, agent: agent.name, output_preview: output.slice(0, 200) });
      } catch (err: any) {
        milestoneResults.push(this.failedMilestone(i, milestone.title, agent, err.message, msStart));
        this.emit('milestone_failed', { task_id, milestone_index: i, error: err.message });
        continue;
      }

      // Platform signs the markMilestone (serviceProvider = platform in escrow)
      let markTxHash: string | null = null;
      try {
        markTxHash = await markMilestone(contractId, i, output.slice(0, 500), this.platformKeypair);
        this.emit('milestone_marked', { task_id, milestone_index: i, tx_hash: markTxHash });
      } catch (err: any) {
        console.warn(`[Executor] markMilestone failed M${i}: ${err.message}`);
      }

      // AI Verifier evaluates
      this.emit('verifying', { task_id, milestone_index: i });
      const verifierResult = await verifyMilestone(
        { acceptanceCriteria: milestone.description, deliverable: output, milestoneTitle: milestone.title },
        contractId, i, this.verifierKeypair,
      );

      this.emit('verified', {
        task_id, milestone_index: i,
        passed: verifierResult.verdict.passed,
        reasoning: verifierResult.verdict.reasoning,
        approval_tx: verifierResult.approvalTxHash,
      });

      let releaseTxHash: string | null = null;
      let disputeStartTxHash: string | null = null;
      let disputeResolveTxHash: string | null = null;
      let disputeResolution = null;

      if (verifierResult.verdict.passed && verifierResult.approvalTxHash) {
        // Release funds
        try {
          releaseTxHash = await releaseMilestone(contractId, i, this.platformKeypair);
          totalCost += milestone.amount;
          this.emit('milestone_released', {
            task_id, milestone_index: i, amount: milestone.amount,
            tx_hash: releaseTxHash, explorer_url: releaseTxHash ? txExplorerUrl(releaseTxHash) : null,
          });
        } catch (err: any) {
          console.warn(`[Executor] releaseMilestone failed: ${err.message}`);
        }
      } else {
        // Rejected → contest → Arbiter
        this.emit('milestone_rejected', { task_id, milestone_index: i, reasoning: verifierResult.verdict.reasoning });

        try {
          disputeStartTxHash = await startDispute(contractId, i, this.platformKeypair);
          this.emit('dispute_started', { task_id, milestone_index: i, tx_hash: disputeStartTxHash });
        } catch (err: any) {
          console.warn(`[Executor] startDispute failed: ${err.message}`);
        }

        const arbiterResult = await arbitrateDispute(
          {
            milestoneTitle: milestone.title,
            acceptanceCriteria: milestone.description,
            deliverable: output,
            verifierReasoning: verifierResult.verdict.reasoning,
            agentContestReason: 'Agent contests: the deliverable addresses the core requirements even if not perfectly formatted.',
            verifierVerdict: verifierResult.verdict,
          },
          contractId, i, milestone.amount,
          agent.stellar_address,
          this.platformKeypair.publicKey(),
          this.arbiterKeypair,
        );

        disputeResolveTxHash = arbiterResult.resolveTxHash;
        disputeResolution = arbiterResult.resolution;
        this.emit('dispute_resolved', { task_id, milestone_index: i, resolution: arbiterResult.resolution, tx_hash: disputeResolveTxHash });

        if (arbiterResult.resolution.agent_pct > 0) {
          totalCost += milestone.amount * arbiterResult.resolution.agent_pct / 100;
        }
      }

      const milestoneResult: MilestoneResult = {
        milestone_index: i,
        title: milestone.title,
        agent_id: agent.agent_id,
        agent_name: agent.name,
        success: verifierResult.verdict.passed || (disputeResolution?.agent_pct ?? 0) > 0,
        output,
        evidence: output.slice(0, 500),
        error: null,
        verifier_verdict: verifierResult.verdict,
        dispute_resolution: disputeResolution,
        tx_hashes: {
          mark: markTxHash ?? undefined,
          approve: verifierResult.approvalTxHash ?? undefined,
          release: releaseTxHash ?? undefined,
          dispute_start: disputeStartTxHash ?? undefined,
          dispute_resolve: disputeResolveTxHash ?? undefined,
        },
        latency_ms: Date.now() - msStart,
        timestamp: new Date().toISOString(),
      };

      milestoneResults.push(milestoneResult);
      previousOutput = output;
      this.postFeedback(agent.agent_id, milestoneResult, registryUrl).catch(() => {});
    }

    const allPassed = milestoneResults.every(r => r.success);
    const anyPassed = milestoneResults.some(r => r.success);
    const status: TaskResult['status'] = allPassed ? 'complete' : anyPassed ? 'partial' : 'failed';

    const taskResult: TaskResult = {
      task_id,
      task,
      escrow_contract_id: contractId,
      escrow_viewer_url: escrowViewerUrl(contractId),
      status,
      milestones: milestoneResults,
      final_output: milestoneResults.filter(r => r.success && r.output).map(r => r.output as string).at(-1) ?? null,
      total_cost: totalCost,
      total_time_ms: Date.now() - startTime,
    };

    this.emit('task_complete', {
      task_id, status, total_cost: totalCost,
      total_time_ms: taskResult.total_time_ms,
      escrow_viewer_url: escrowViewerUrl(contractId),
    });

    return taskResult;
  }

  private failedMilestone(index: number, title: string, agent: AgentRecord, error: string, startTime: number): MilestoneResult {
    return {
      milestone_index: index,
      title,
      agent_id: agent.agent_id,
      agent_name: agent.name,
      success: false,
      output: null,
      evidence: null,
      error,
      verifier_verdict: null,
      dispute_resolution: null,
      tx_hashes: {},
      latency_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  private async postFeedback(agentId: string, result: MilestoneResult, registryUrl: string): Promise<void> {
    await fetch(`${registryUrl}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentId,
        job_id: uuidv4(),
        success: result.success,
        quality_rating: result.success ? 4 : 2,
        latency_ms: result.latency_ms,
        timestamp: result.timestamp,
      }),
      signal: AbortSignal.timeout(5000),
    });
  }
}
