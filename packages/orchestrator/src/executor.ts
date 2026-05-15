/**
 * Conductor Execution Engine
 *
 * Human-override mode: escrow deployed with user wallet as Approver.
 * Server fetches unsigned approveMilestone XDR, sends to browser via WS event,
 * Freighter signs it, browser submits signed XDR back, server continues.
 * Dispute resolver is always the AI Arbiter so dispute path still works.
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
  getApproveMilestoneXdr,
  submitSignedTransaction,
  type DeployEscrowSpec,
} from './trustless-work-client.js';
import { verifyMilestone, getVerifierVerdict, loadVerifierKeypair } from './verifier.js';
import { arbitrateDispute, loadArbiterKeypair } from './arbiter.js';
import { selectBestAgent } from './selector.js';

export interface ExecutorOptions {
  contractId?: string;
  humanOverride?: {
    approver?: string;        // human wallet — escrow approver role
    disputeResolver?: string; // ignored; AI Arbiter always handles disputes
  };
}

interface HumanDecision {
  approved: boolean;
  signedXdr?: string; // Freighter-signed approveMilestone XDR (present when approved)
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

  // Human-review gates: keyed by "taskId:milestoneIndex"
  private humanDecisionMap = new Map<string, (d: HumanDecision) => void>();

  constructor(availableAgents: AgentRecord[]) {
    super();
    this.agentMap = new Map(availableAgents.map(a => [a.agent_id, a]));
    this.platformKeypair = Keypair.fromSecret(process.env.PLATFORM_SECRET_KEY!);
    this.verifierKeypair = loadVerifierKeypair();
    this.arbiterKeypair = loadArbiterKeypair();
  }

  // Called by server.ts when the human clicks Approve or Reject in the dashboard
  resolveHumanDecision(taskId: string, milestoneIndex: number, decision: HumanDecision) {
    const key = `${taskId}:${milestoneIndex}`;
    const cb = this.humanDecisionMap.get(key);
    if (cb) {
      this.humanDecisionMap.delete(key);
      cb(decision);
    }
  }

  private waitForHumanDecision(
    taskId: string,
    milestoneIndex: number,
    timeoutMs = 10 * 60 * 1000,
  ): Promise<HumanDecision> {
    const key = `${taskId}:${milestoneIndex}`;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        if (this.humanDecisionMap.has(key)) {
          this.humanDecisionMap.delete(key);
          console.log(`[Executor] Human review timed out for M${milestoneIndex} — auto-rejecting`);
          resolve({ approved: false });
        }
      }, timeoutMs);

      this.humanDecisionMap.set(key, decision => {
        clearTimeout(timer);
        resolve(decision);
      });
    });
  }

  async execute(
    plan: ExecutionPlan,
    task: string,
    registryUrl: string,
    userAddress: string | null,
    options: ExecutorOptions = {},
    taskId?: string,  // use the server's task_id so activeExecutors lookups match
  ): Promise<TaskResult> {
    const task_id = taskId ?? uuidv4();
    const startTime = Date.now();
    const agents = [...this.agentMap.values()];
    const isHumanMode = !!options.humanOverride?.approver;
    const humanApproverAddress = options.humanOverride?.approver ?? '';

    this.emit('task_started', { task_id, task, milestone_count: plan.milestones.length });

    // ── Per-milestone agent selection ─────────────────────────────────────────
    const milestoneAgents: AgentRecord[] = plan.milestones.map(m => {
      if (m.capabilityTags.length > 0) {
        const best = selectBestAgent(agents, m.capabilityTags);
        if (best) return best.agent;
      }
      return agents.sort((a, b) => b.reputation.score - a.reputation.score)[0];
    });

    for (let i = 0; i < plan.milestones.length; i++) {
      const a = milestoneAgents[i];
      console.log(`[Executor] M${i} "${plan.milestones[i].title}" → ${a?.name ?? '?'}`);
    }

    // ── Deploy escrow ─────────────────────────────────────────────────────────
    // In human mode: escrow Approver = human wallet; Dispute Resolver = AI Arbiter always.
    let contractId = options.contractId ?? '';
    let deployTxHash = '';

    if (!contractId) {
      this.emit('escrow_deploying', { task_id, milestone_count: plan.milestones.length });

      const escrowSpec: DeployEscrowSpec = {
        title: task.slice(0, 100),
        description: task,
        platformAddress: this.platformKeypair.publicKey(),
        serviceProvider: this.platformKeypair.publicKey(),
        approver: isHumanMode ? humanApproverAddress : this.verifierKeypair.publicKey(),
        disputeResolver: this.arbiterKeypair.publicKey(), // always AI Arbiter
        releaseSigner: this.platformKeypair.publicKey(),
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
        human_mode: isHumanMode,
        approver: isHumanMode ? humanApproverAddress : this.verifierKeypair.publicKey(),
      });
    }

    // ── Auto-fund ─────────────────────────────────────────────────────────────
    const totalUsdc = plan.milestones.reduce((s, m) => s + m.amount, 0);
    try {
      const fundTx = await fundEscrow(contractId, this.platformKeypair, totalUsdc.toFixed(7));
      this.emit('escrow_funded', { task_id, contract_id: contractId, tx_hash: fundTx, amount_usdc: totalUsdc });
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

      const healthy = await checkHealth(agent);
      if (!healthy) {
        milestoneResults.push(this.failedMilestone(i, milestone.title, agent, 'Agent health check failed', msStart));
        this.emit('milestone_failed', { task_id, milestone_index: i, error: 'Agent health check failed' });
        continue;
      }

      let output: string | null = null;
      try {
        output = await callAgent(agent, `${milestone.title}: ${milestone.description}`, previousOutput ?? undefined);
        this.emit('agent_output', { task_id, milestone_index: i, agent: agent.name, output_preview: output.slice(0, 200) });
      } catch (err: any) {
        milestoneResults.push(this.failedMilestone(i, milestone.title, agent, err.message, msStart));
        this.emit('milestone_failed', { task_id, milestone_index: i, error: err.message });
        continue;
      }

      let markTxHash: string | null = null;
      try {
        markTxHash = await markMilestone(contractId, i, output.slice(0, 500), this.platformKeypair);
        this.emit('milestone_marked', { task_id, milestone_index: i, tx_hash: markTxHash });
      } catch (err: any) {
        console.warn(`[Executor] markMilestone failed M${i}: ${err.message}`);
      }

      // ── Verify & release: human mode vs AI mode ───────────────────────────
      let releaseTxHash: string | null = null;
      let disputeStartTxHash: string | null = null;
      let disputeResolveTxHash: string | null = null;
      let disputeResolution = null;
      let verifierVerdict: any = null;

      this.emit('verifying', { task_id, milestone_index: i });

      if (isHumanMode) {
        // ── HUMAN MODE ───────────────────────────────────────────────────────
        // Get AI recommendation (Claude verdict only, no on-chain action)
        let aiVerdict;
        try {
          aiVerdict = await getVerifierVerdict({
            acceptanceCriteria: milestone.description,
            deliverable: output,
            milestoneTitle: milestone.title,
          });
        } catch (err: any) {
          console.warn(`[Executor] getVerifierVerdict failed M${i}: ${err.message}`);
          aiVerdict = { passed: false, reasoning: 'AI evaluation failed — please review manually.', per_criterion: [] };
        }
        verifierVerdict = aiVerdict;

        // Fetch unsigned XDR so Freighter can sign it
        let approveXdr = '';
        try {
          approveXdr = await getApproveMilestoneXdr(contractId, i, humanApproverAddress);
        } catch (err: any) {
          console.warn(`[Executor] getApproveMilestoneXdr failed M${i}: ${err.message}`);
        }

        // Pause — wait for human to approve or reject in the dashboard
        this.emit('human_review_required', {
          task_id,
          milestone_index: i,
          title: milestone.title,
          deliverable: output,
          ai_recommendation: aiVerdict,
          approve_xdr: approveXdr,
          contract_id: contractId,
        });

        const decision = await this.waitForHumanDecision(task_id, i);

        this.emit('verified', {
          task_id,
          milestone_index: i,
          passed: decision.approved,
          reasoning: decision.approved
            ? 'Human reviewer approved this milestone.'
            : 'Human reviewer rejected this milestone.',
          approval_tx: null,
        });

        if (decision.approved && decision.signedXdr) {
          try {
            // Submit Freighter-signed approveMilestone
            const approveTxHash = await submitSignedTransaction(decision.signedXdr);
            console.log(`[Executor] Human approval submitted on-chain: ${approveTxHash}`);

            releaseTxHash = await releaseMilestone(contractId, i, this.platformKeypair);
            totalCost += milestone.amount;
            this.emit('milestone_released', {
              task_id,
              milestone_index: i,
              amount: milestone.amount,
              tx_hash: releaseTxHash,
              explorer_url: releaseTxHash ? txExplorerUrl(releaseTxHash) : null,
            });
          } catch (err: any) {
            console.warn(`[Executor] Human approval/release failed M${i}: ${err.message}`);
          }
        } else {
          // Human rejected → AI Arbiter dispute
          this.emit('milestone_rejected', { task_id, milestone_index: i, reasoning: 'Human reviewer rejected' });
          try {
            disputeStartTxHash = await startDispute(contractId, i, this.platformKeypair);
            this.emit('dispute_started', { task_id, milestone_index: i, tx_hash: disputeStartTxHash });
          } catch (err: any) {
            console.warn(`[Executor] startDispute failed M${i}: ${err.message}`);
          }

          const arbiterResult = await arbitrateDispute(
            {
              milestoneTitle: milestone.title,
              acceptanceCriteria: milestone.description,
              deliverable: output,
              verifierReasoning: aiVerdict.reasoning,
              agentContestReason: 'Human reviewer rejected. Agent requests fair arbiter review.',
              verifierVerdict: aiVerdict,
            },
            contractId, i, milestone.amount,
            agent.stellar_address,
            this.platformKeypair.publicKey(),
            this.arbiterKeypair,
          );

          disputeResolveTxHash = arbiterResult.resolveTxHash;
          disputeResolution = arbiterResult.resolution;
          this.emit('dispute_resolved', {
            task_id, milestone_index: i,
            resolution: arbiterResult.resolution,
            tx_hash: disputeResolveTxHash,
          });
          if (arbiterResult.resolution.agent_pct > 0) {
            totalCost += milestone.amount * arbiterResult.resolution.agent_pct / 100;
          }
        }

      } else {
        // ── AI MODE ──────────────────────────────────────────────────────────
        let verifierResult;
        try {
          verifierResult = await verifyMilestone(
            { acceptanceCriteria: milestone.description, deliverable: output, milestoneTitle: milestone.title },
            contractId, i, this.verifierKeypair,
          );
        } catch (err: any) {
          console.warn(`[Executor] verifyMilestone failed M${i}: ${err.message}`);
          verifierResult = { verdict: { passed: false, reasoning: `Verifier error: ${err.message}`, per_criterion: [] }, approvalTxHash: null };
        }
        verifierVerdict = verifierResult.verdict;

        this.emit('verified', {
          task_id, milestone_index: i,
          passed: verifierResult.verdict.passed,
          reasoning: verifierResult.verdict.reasoning,
          approval_tx: verifierResult.approvalTxHash,
        });

        if (verifierResult.verdict.passed && verifierResult.approvalTxHash) {
          try {
            releaseTxHash = await releaseMilestone(contractId, i, this.platformKeypair);
            totalCost += milestone.amount;
            this.emit('milestone_released', {
              task_id, milestone_index: i, amount: milestone.amount,
              tx_hash: releaseTxHash, explorer_url: releaseTxHash ? txExplorerUrl(releaseTxHash) : null,
            });
          } catch (err: any) {
            console.warn(`[Executor] releaseMilestone failed M${i}: ${err.message}`);
          }
        } else {
          this.emit('milestone_rejected', { task_id, milestone_index: i, reasoning: verifierResult.verdict.reasoning });

          try {
            disputeStartTxHash = await startDispute(contractId, i, this.platformKeypair);
            this.emit('dispute_started', { task_id, milestone_index: i, tx_hash: disputeStartTxHash });
          } catch (err: any) {
            console.warn(`[Executor] startDispute failed M${i}: ${err.message}`);
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
          this.emit('dispute_resolved', {
            task_id, milestone_index: i,
            resolution: arbiterResult.resolution,
            tx_hash: disputeResolveTxHash,
          });
          if (arbiterResult.resolution.agent_pct > 0) {
            totalCost += milestone.amount * arbiterResult.resolution.agent_pct / 100;
          }
        }
      }

      const milestoneResult: MilestoneResult = {
        milestone_index: i,
        title: milestone.title,
        agent_id: agent.agent_id,
        agent_name: agent.name,
        success: !!releaseTxHash || (disputeResolution?.agent_pct ?? 0) > 0,
        output,
        evidence: output.slice(0, 500),
        error: null,
        verifier_verdict: verifierVerdict,
        dispute_resolution: disputeResolution,
        tx_hashes: {
          mark: markTxHash ?? undefined,
          approve: undefined,
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
