/**
 * Conductor Execution Engine
 *
 * Runs the full milestone lifecycle for a single escrow:
 *   deploy → fund (human) → for each milestone:
 *     agent work → mark → verify → approve/dispute → release
 *
 * All AI-signed actions use server-side keypairs.
 * The human's only required action is funding the escrow.
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
  markMilestone,
  releaseMilestone,
  startDispute,
  type DeployEscrowSpec,
} from './trustless-work-client.js';
import { verifyMilestone, loadVerifierKeypair } from './verifier.js';
import { arbitrateDispute, loadArbiterKeypair } from './arbiter.js';
import { planToEscrowSpec } from './planner.js';
import { selectBestAgent } from './selector.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExecutorOptions {
  contractId?: string;       // pre-deployed escrow (skip deploy step)
  humanOverride?: {
    approver?: string;       // human wallet address to use as Approver
    disputeResolver?: string;
  };
}

// ── Health check ──────────────────────────────────────────────────────────────

async function checkHealth(agent: AgentRecord): Promise<boolean> {
  const delays = [0, 10000, 10000, 10000, 10000, 10000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) await new Promise(r => setTimeout(r, delays[attempt]));
    try {
      const response = await fetch(agent.health_check, { signal: AbortSignal.timeout(15000) });
      if (response.ok) return true;
      if (response.status !== 503 && response.status !== 502) return false;
    } catch {
      // keep retrying
    }
  }
  return false;
}

// ── Agent call (no payment — payment is escrow release) ───────────────────────

async function callAgent(
  agent: AgentRecord,
  action: string,
  context?: string,
): Promise<string> {
  const body: Record<string, string> = { instruction: action };
  if (context) body.context = context;

  const response = await fetch(agent.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Agent ${agent.name} returned ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
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

    this.emit('task_started', { task_id, task, milestone_count: plan.milestones.length });

    // ── Select specialist agent ───────────────────────────────────────────────
    const allCaps = plan.milestones.flatMap(m => m.capabilityTags);
    const uniqueCaps = [...new Set(allCaps)];
    const agents = [...this.agentMap.values()];

    let selectedAgent: AgentRecord | null = null;
    if (plan.selected_agent_id) {
      selectedAgent = this.agentMap.get(plan.selected_agent_id) ?? null;
    }
    if (!selectedAgent) {
      const scored = selectBestAgent(agents, uniqueCaps);
      selectedAgent = scored?.agent ?? null;
    }
    if (!selectedAgent) {
      throw new Error('No suitable agent found for this task');
    }

    const agentKeypair = Keypair.fromSecret(
      this.getAgentSecret(selectedAgent.agent_id) ?? ''
    );

    // ── Deploy escrow ─────────────────────────────────────────────────────────
    let contractId = options.contractId ?? '';
    let escrowDeployTxHash = '';

    if (!contractId) {
      this.emit('escrow_deploying', { task_id, agent: selectedAgent.name });

      const escrowSpec: DeployEscrowSpec = planToEscrowSpec(plan, task, {
        platformAddress: this.platformKeypair.publicKey(),
        serviceProvider: selectedAgent.stellar_address,
        approver: this.verifierKeypair.publicKey(),
        disputeResolver: this.arbiterKeypair.publicKey(),
        releaseSigner: this.platformKeypair.publicKey(),
        receiver: selectedAgent.stellar_address,  // used per-milestone
        humanOverride: options.humanOverride,
      });

      const deployResult = await deployEscrow(escrowSpec, this.platformKeypair);
      contractId = deployResult.contractId;
      escrowDeployTxHash = deployResult.transactionHash;

      this.emit('escrow_deployed', {
        task_id,
        contract_id: contractId,
        tx_hash: escrowDeployTxHash,
        viewer_url: escrowViewerUrl(contractId),
      });
    }

    // ── Wait for human funding (emits event; orchestrator server handles the gate) ──
    this.emit('funding_required', {
      task_id,
      contract_id: contractId,
      viewer_url: escrowViewerUrl(contractId),
      total_usdc: plan.total_estimated_cost,
      message: 'Fund the escrow in Freighter to begin execution',
    });

    // ── Execute milestones sequentially ──────────────────────────────────────
    const milestoneResults: MilestoneResult[] = [];
    let previousOutput: string | null = null;
    let totalCost = 0;

    for (let i = 0; i < plan.milestones.length; i++) {
      const milestone = plan.milestones[i];
      const msStart = Date.now();

      this.emit('milestone_started', {
        task_id,
        milestone_index: i,
        title: milestone.title,
        agent: selectedAgent.name,
      });

      const healthy = await checkHealth(selectedAgent);
      if (!healthy) {
        const result: MilestoneResult = this.makeFailedMilestone(
          i, milestone.title, selectedAgent, `Agent health check failed`, msStart
        );
        milestoneResults.push(result);
        continue;
      }

      // ── Agent does the work ───────────────────────────────────────────────
      let output: string | null = null;
      try {
        output = await callAgent(
          selectedAgent,
          milestone.title + ': ' + milestone.description,
          previousOutput ?? undefined,
        );

        this.emit('agent_output', {
          task_id,
          milestone_index: i,
          agent: selectedAgent.name,
          output_preview: output.slice(0, 200),
        });
      } catch (err: any) {
        const result: MilestoneResult = this.makeFailedMilestone(
          i, milestone.title, selectedAgent, err.message, msStart
        );
        milestoneResults.push(result);
        this.emit('milestone_failed', { task_id, milestone_index: i, error: err.message });
        continue;
      }

      // ── Mark milestone as done ───────────────────────────────────────────
      let markTxHash: string | null = null;
      try {
        markTxHash = await markMilestone(contractId, i, output.slice(0, 500), agentKeypair);
        this.emit('milestone_marked', { task_id, milestone_index: i, tx_hash: markTxHash });
      } catch (err: any) {
        console.warn(`[Executor] markMilestone failed for ${i}: ${err.message}`);
      }

      // ── AI Verifier evaluates deliverable ────────────────────────────────
      this.emit('verifying', { task_id, milestone_index: i });

      const verifierResult = await verifyMilestone(
        {
          acceptanceCriteria: milestone.description,
          deliverable: output,
          milestoneTitle: milestone.title,
        },
        contractId,
        i,
        this.verifierKeypair,
      );

      this.emit('verified', {
        task_id,
        milestone_index: i,
        passed: verifierResult.verdict.passed,
        reasoning: verifierResult.verdict.reasoning,
        approval_tx: verifierResult.approvalTxHash,
      });

      let releaseTxHash: string | null = null;
      let disputeStartTxHash: string | null = null;
      let disputeResolveTxHash: string | null = null;
      let disputeResolution = null;

      if (verifierResult.verdict.passed && verifierResult.approvalTxHash) {
        // ── Release funds ────────────────────────────────────────────────
        try {
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
          console.warn(`[Executor] releaseMilestone failed: ${err.message}`);
        }
      } else {
        // ── Verifier rejected → auto-contest → AI Arbiter resolves ───────
        this.emit('milestone_rejected', {
          task_id,
          milestone_index: i,
          reasoning: verifierResult.verdict.reasoning,
        });

        // Agent auto-contests (in demo path)
        try {
          disputeStartTxHash = await startDispute(contractId, i, agentKeypair);
          this.emit('dispute_started', { task_id, milestone_index: i, tx_hash: disputeStartTxHash });
        } catch (err: any) {
          console.warn(`[Executor] startDispute failed: ${err.message}`);
        }

        // AI Arbiter resolves — pass milestone amount + addresses for absolute distribution amounts
        const arbiterResult = await arbitrateDispute(
          {
            milestoneTitle: milestone.title,
            acceptanceCriteria: milestone.description,
            deliverable: output,
            verifierReasoning: verifierResult.verdict.reasoning,
            agentContestReason: 'Agent contests the rejection — the deliverable addresses the stated requirements.',
            verifierVerdict: verifierResult.verdict,
          },
          contractId,
          i,
          milestone.amount,                        // needed to compute absolute distribution amounts
          selectedAgent.stellar_address,            // receiver (agent)
          this.platformKeypair.publicKey(),         // funder (platform refund address)
          this.arbiterKeypair,
        );

        disputeResolveTxHash = arbiterResult.resolveTxHash;
        disputeResolution = arbiterResult.resolution;

        this.emit('dispute_resolved', {
          task_id,
          milestone_index: i,
          resolution: arbiterResult.resolution,
          tx_hash: disputeResolveTxHash,
        });

        if (arbiterResult.resolution.agent_pct > 0) {
          totalCost += milestone.amount * arbiterResult.resolution.agent_pct / 100;
        }
      }

      const milestoneResult: MilestoneResult = {
        milestone_index: i,
        title: milestone.title,
        agent_id: selectedAgent.agent_id,
        agent_name: selectedAgent.name,
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

      // Post feedback to registry
      this.postFeedback(selectedAgent.agent_id, milestoneResult, registryUrl).catch(() => {});
    }

    const allPassed = milestoneResults.every(r => r.success);
    const anyPassed = milestoneResults.some(r => r.success);
    const status: TaskResult['status'] = allPassed ? 'complete' : anyPassed ? 'partial' : 'failed';

    const finalOutput = milestoneResults
      .filter(r => r.success && r.output)
      .map(r => r.output as string)
      .at(-1) ?? null;

    const taskResult: TaskResult = {
      task_id,
      task,
      escrow_contract_id: contractId,
      escrow_viewer_url: escrowViewerUrl(contractId),
      status,
      milestones: milestoneResults,
      final_output: finalOutput,
      total_cost: totalCost,
      total_time_ms: Date.now() - startTime,
    };

    this.emit('task_complete', {
      task_id,
      status,
      total_cost: totalCost,
      total_time_ms: taskResult.total_time_ms,
      escrow_viewer_url: escrowViewerUrl(contractId),
    });

    return taskResult;
  }

  private makeFailedMilestone(
    index: number,
    title: string,
    agent: AgentRecord,
    error: string,
    startTime: number,
  ): MilestoneResult {
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

  private getAgentSecret(agentId: string): string | undefined {
    const keyMap: Record<string, string> = {
      'stellar-oracle': process.env.STELLAR_ORACLE_SECRET_KEY ?? '',
      'web-intel': process.env.WEB_INTEL_SECRET_KEY ?? '',
      'web-intel-v2': process.env.WEB_INTEL_V2_SECRET_KEY ?? '',
      'analysis-agent': process.env.ANALYSIS_AGENT_SECRET_KEY ?? '',
      'reporter-agent': process.env.REPORT_AGENT_SECRET_KEY ?? '',
    };
    return keyMap[agentId] || undefined;
  }

  private async postFeedback(
    agentId: string,
    result: MilestoneResult,
    registryUrl: string,
  ): Promise<void> {
    const body = {
      agent_id: agentId,
      job_id: uuidv4(),
      success: result.success,
      quality_rating: result.success ? 4 : 2,
      latency_ms: result.latency_ms,
      timestamp: result.timestamp,
    };
    await fetch(`${registryUrl}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  }
}
