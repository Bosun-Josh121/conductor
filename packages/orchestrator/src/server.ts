/**
 * Conductor Orchestrator — HTTP + WebSocket server
 *
 * POST /api/tasks                   — submit a task for execution
 * POST /api/tasks/:id/approve       — approve the pending plan
 * POST /api/tasks/:id/reject        — reject the pending plan
 * POST /api/tasks/:id/fund-confirm  — confirm human has funded the escrow
 * GET  /api/agents                  — list registered agents
 * GET  /api/wallets                 — show role wallet info
 * GET  /api/escrow/:contractId      — live on-chain escrow state
 * GET  /api/tasks/history/:addr     — task history for a user
 * POST /api/register                — proxy agent registration to registry
 * GET  /health                      — liveness check
 * WS   /ws                          — real-time event stream
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import {
  Keypair,
  Account,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Asset,
  Operation,
} from '@stellar/stellar-sdk';
import type { AgentRecord } from '@conductor/common';
import { accountExplorerUrl, escrowViewerUrl } from '@conductor/common';
import { checkFeasibility } from './capability-check.js';
import { createPlan } from './planner.js';
import { PlanExecutor } from './executor.js';
import { scoreAgents } from './selector.js';
import * as activityStore from './activity-store.js';
import { appendEscrowTx, getEscrowLedger } from './escrow-ledger.js';
import { saveTaskResult, getTaskResults, deleteTaskResult } from './task-results.js';
import { getEscrow, submitSignedTransaction } from './trustless-work-client.js';

const __dirname = path.dirname(path.resolve(process.argv[1]));

const PORT = parseInt(process.env.ORCHESTRATOR_PORT || process.env.PORT || '3000');
const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4000';
const BUDGET_DEFAULT = parseFloat(process.env.DEFAULT_BUDGET || '1.0');
const APPROVAL_TIMEOUT_MS = parseInt(process.env.PLAN_APPROVAL_TIMEOUT_MS || '60000');
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';

const USDC_ISSUER = process.env.USDC_ASSET_ISSUER || 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC_ASSET = new Asset(process.env.USDC_ASSET_CODE || 'USDC', USDC_ISSUER);

if (!process.env.PLATFORM_SECRET_KEY) {
  console.error('[Orchestrator] PLATFORM_SECRET_KEY not set');
  process.exit(1);
}

const platformKeypair = Keypair.fromSecret(process.env.PLATFORM_SECRET_KEY);
const PLATFORM_ADDRESS = platformKeypair.publicKey();

// ── Registry helpers ──────────────────────────────────────────────────────────

async function fetchAgents(): Promise<AgentRecord[]> {
  const response = await fetch(`${REGISTRY_URL}/agents`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Registry returned ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : data.agents ?? [];
}

// ── WebSocket broadcast ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(event: string, data: unknown) {
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

// ── Plan approval gate ────────────────────────────────────────────────────────

interface PendingApproval {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingApprovals = new Map<string, PendingApproval>();

function waitForApproval(task_id: string, planPayload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingApprovals.has(task_id)) {
        pendingApprovals.delete(task_id);
        broadcast('plan_auto_approved', { task_id, reason: 'timeout' });
        resolve();
      }
    }, APPROVAL_TIMEOUT_MS);

    pendingApprovals.set(task_id, { resolve, reject, timer });
    broadcast('plan_approval_required', planPayload);
  });
}

// ── Funding gate — waits for human to fund escrow ─────────────────────────────

interface PendingFunding {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingFunding = new Map<string, PendingFunding>();

function waitForFunding(task_id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Auto-timeout after 10 minutes
    const timer = setTimeout(() => {
      if (pendingFunding.has(task_id)) {
        pendingFunding.delete(task_id);
        reject(new Error('Funding timeout — no funding confirmation received within 10 minutes'));
      }
    }, 10 * 60 * 1000);

    pendingFunding.set(task_id, { resolve, reject, timer });
  });
}

// ── Express app ────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

const dashboardPath = path.join(__dirname, '..', 'public');
app.use(express.static(dashboardPath));
app.get('/', (_req, res) => {
  const indexPath = path.join(dashboardPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).json({ error: 'Dashboard not built. Run: npm run build:dashboard' });
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    agent: 'Conductor Orchestrator',
    platform_address: PLATFORM_ADDRESS,
    explorer_url: accountExplorerUrl(PLATFORM_ADDRESS),
  });
});

app.get('/api/agents', async (_req, res) => {
  try {
    const agents = await fetchAgents();
    res.json({ agents, count: agents.length });
  } catch (err: any) {
    res.status(502).json({ error: `Failed to reach registry: ${err.message}` });
  }
});

app.get('/api/wallets', (_req, res) => {
  res.json({
    platform: {
      address: PLATFORM_ADDRESS,
      network: 'stellar:testnet',
      explorer_url: accountExplorerUrl(PLATFORM_ADDRESS),
      role: 'platform + releaseSigner',
    },
    verifier: {
      address: process.env.VERIFIER_SECRET_KEY
        ? Keypair.fromSecret(process.env.VERIFIER_SECRET_KEY).publicKey()
        : null,
      role: 'approver',
    },
    arbiter: {
      address: process.env.ARBITER_SECRET_KEY
        ? Keypair.fromSecret(process.env.ARBITER_SECRET_KEY).publicKey()
        : null,
      role: 'disputeResolver',
    },
  });
});

// Live on-chain escrow state
app.get('/api/escrow/:contractId', async (req, res) => {
  try {
    const data = await getEscrow(req.params.contractId);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// Submit a signed XDR from Freighter (deploy/fund)
app.post('/api/escrow/submit', async (req, res) => {
  const { signed_xdr } = req.body as { signed_xdr?: string };
  if (!signed_xdr) return res.status(400).json({ error: 'signed_xdr is required' });
  try {
    const txHash = await submitSignedTransaction(signed_xdr);
    res.json({ success: true, tx_hash: txHash });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Build USDC changeTrust XDR for user to sign in Freighter
app.post('/api/usdc-trustline', async (req, res) => {
  const { user_address } = req.body as { user_address?: string };
  if (!user_address) return res.status(400).json({ error: 'user_address is required' });
  try {
    const accountRes = await fetch(`${HORIZON_URL}/accounts/${user_address}`, { signal: AbortSignal.timeout(10000) });
    if (!accountRes.ok) throw new Error(`Account not found: ${user_address}`);
    const accountData = await accountRes.json();
    const account = new Account(accountData.account_id, accountData.sequence);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.changeTrust({ asset: USDC_ASSET }))
      .setTimeout(30)
      .build();
    res.json({ xdr: tx.toEnvelope().toXDR('base64') });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy agent registration
async function proxyRegister(req: express.Request, res: express.Response) {
  try {
    const resp = await fetch(`${REGISTRY_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(8000),
    });
    const data = await resp.json().catch(() => ({}));
    res.status(resp.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Failed to reach registry: ${err.message}` });
  }
}
app.post('/api/register', proxyRegister);
app.post('/api/agents/register', proxyRegister);

app.patch('/api/agents/:id', async (req, res) => {
  try {
    const resp = await fetch(`${REGISTRY_URL}/agents/${encodeURIComponent(req.params.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json().catch(() => ({}));
    res.status(resp.status).json(data);
  } catch (err: any) {
    res.status(502).json({ error: `Failed to reach registry: ${err.message}` });
  }
});

app.delete('/api/agents/:id', async (req, res) => {
  const { requester_address } = req.body as { requester_address?: string };
  if (!requester_address) return res.status(400).json({ error: 'requester_address is required' });
  try {
    const resp = await fetch(`${REGISTRY_URL}/agents/${encodeURIComponent(req.params.id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester_address }),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.status === 403) return res.status(403).json(await resp.json());
    if (resp.status === 404) return res.status(404).json({ error: 'Agent not found' });
    if (!resp.ok) return res.status(502).json({ error: `Registry returned ${resp.status}` });
    res.json({ deleted: true, agent_id: req.params.id });
  } catch (err: any) {
    res.status(502).json({ error: `Failed to reach registry: ${err.message}` });
  }
});

app.get('/api/stats/pulse', (_req, res) => {
  res.json(activityStore.getPulse());
});

app.get('/api/activity/:user_address', (req, res) => {
  const events = activityStore.getForUser(req.params.user_address, 50);
  res.json({ events });
});

app.get('/api/escrow-ledger/:user_address', (req, res) => {
  const entries = getEscrowLedger(req.params.user_address, 100);
  res.json({ entries });
});

app.get('/api/tasks/history/:user_address', (req, res) => {
  const results = getTaskResults(req.params.user_address, 50);
  res.json({ results });
});

app.delete('/api/tasks/history/:task_id', (req, res) => {
  const user_address = req.query.user_address as string | undefined;
  if (!user_address) return res.status(400).json({ error: 'user_address query param is required' });
  const results = getTaskResults(user_address, 1000);
  const owned = results.some(r => r.task_id === req.params.task_id);
  if (!owned) return res.status(403).json({ error: 'Not authorised or task not found' });
  const deleted = deleteTaskResult(req.params.task_id);
  if (!deleted) return res.status(404).json({ error: 'Task not found' });
  res.json({ success: true });
});

// Preview a task (feasibility + plan, no execution)
app.post('/api/tasks/preview', async (req, res) => {
  const { task, budget } = req.body as { task?: string; budget?: number };
  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    return res.status(400).json({ error: 'task is required' });
  }
  const taskBudget = typeof budget === 'number' && budget > 0 ? budget : BUDGET_DEFAULT;

  let agents: AgentRecord[];
  try { agents = await fetchAgents(); }
  catch (err: any) { return res.status(503).json({ error: 'registry_unavailable', message: err.message }); }
  if (agents.length === 0) return res.status(503).json({ error: 'no_agents', message: 'No agents registered' });

  let feasibility;
  try { feasibility = await checkFeasibility(task, agents); }
  catch (err: any) { return res.status(500).json({ error: 'feasibility_failed', message: err.message }); }

  if (!feasibility.feasible) {
    return res.json({ feasible: false, missing: feasibility.missing });
  }

  let plan;
  try { plan = await createPlan(task, agents, taskBudget); }
  catch (err: any) { return res.status(500).json({ error: 'planning_failed', message: err.message }); }

  return res.json({
    feasible: true,
    total_estimated_cost: plan.total_estimated_cost,
    milestones: plan.milestones.map(m => ({ title: m.title, description: m.description, amount: m.amount })),
    reasoning: plan.reasoning,
    selected_agent_id: plan.selected_agent_id,
    over_budget: plan.total_estimated_cost > taskBudget,
    budget: taskBudget,
  });
});

// Submit a task
app.post('/api/tasks', async (req, res) => {
  const { task, budget, user_address, human_override_approver, human_override_resolver } = req.body as {
    task?: string;
    budget?: number;
    user_address?: string;
    human_override_approver?: string;
    human_override_resolver?: string;
  };

  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    return res.status(400).json({ error: 'task is required' });
  }

  const taskBudget = typeof budget === 'number' && budget > 0 ? budget : BUDGET_DEFAULT;
  const task_id = uuidv4();

  res.status(202).json({ status: 'accepted', task_id, task, budget: taskBudget });
  broadcast('task_accepted', { task_id, task, budget: taskBudget });

  runTask(task_id, task, taskBudget, user_address ?? null, {
    humanOverride: {
      approver: human_override_approver,
      disputeResolver: human_override_resolver,
    },
  }).catch(err => {
    console.error('[Orchestrator] Task pipeline error:', err.message);
    broadcast('task_error', { task_id, task, error: err.message });
  });
});

// Approve a pending plan
app.post('/api/tasks/:id/approve', (req, res) => {
  const { id } = req.params;
  const pending = pendingApprovals.get(id);
  if (!pending) return res.status(404).json({ error: 'No pending approval for this task' });
  clearTimeout(pending.timer);
  pendingApprovals.delete(id);
  broadcast('plan_approved', { task_id: id });
  pending.resolve();
  res.json({ status: 'approved', task_id: id });
});

// Reject a pending plan
app.post('/api/tasks/:id/reject', (req, res) => {
  const { id } = req.params;
  const pending = pendingApprovals.get(id);
  if (!pending) return res.status(404).json({ error: 'No pending approval for this task' });
  clearTimeout(pending.timer);
  pendingApprovals.delete(id);
  broadcast('plan_rejected', { task_id: id });
  pending.reject(new Error('Plan rejected by user'));
  res.json({ status: 'rejected', task_id: id });
});

// Confirm escrow funded (human confirms Freighter signing)
app.post('/api/tasks/:id/fund-confirm', (req, res) => {
  const { id } = req.params;
  const pending = pendingFunding.get(id);
  if (!pending) return res.status(404).json({ error: 'No pending funding for this task' });
  clearTimeout(pending.timer);
  pendingFunding.delete(id);
  broadcast('escrow_funded', { task_id: id });
  pending.resolve();
  res.json({ status: 'funded', task_id: id });
});

// ── Task pipeline ─────────────────────────────────────────────────────────────

async function runTask(
  task_id: string,
  task: string,
  budget: number,
  userAddress: string | null,
  options: { humanOverride?: { approver?: string; disputeResolver?: string } },
): Promise<void> {
  let agents: AgentRecord[];
  try {
    agents = await fetchAgents();
    broadcast('agents_loaded', { task_id, count: agents.length });
  } catch (err: any) {
    broadcast('task_error', { task_id, task, error: `Registry unavailable: ${err.message}` });
    return;
  }

  if (agents.length === 0) {
    broadcast('task_error', { task_id, task, error: 'No agents registered' });
    return;
  }

  const allScored = scoreAgents(agents, [], budget / Math.max(1, agents.length));
  broadcast('agents_scored', {
    task_id,
    agents: allScored.map(s => ({
      agent_id: s.agent.agent_id,
      name: s.agent.name,
      score: s.score,
      reputation_score: s.agent.reputation?.score ?? 50,
      price_per_call: s.agent.pricing.price_per_call,
    })),
  });

  let feasibility;
  try {
    feasibility = await checkFeasibility(task, agents);
    broadcast('feasibility_checked', { task_id, ...feasibility });
  } catch (err: any) {
    broadcast('task_error', { task_id, task, error: `Feasibility check failed: ${err.message}` });
    return;
  }

  if (!feasibility.feasible) {
    broadcast('task_infeasible', { task_id, task, missing: feasibility.missing });
    return;
  }

  let plan;
  try {
    plan = await createPlan(task, agents, budget);
  } catch (err: any) {
    broadcast('task_error', { task_id, task, error: `Planning failed: ${err.message}` });
    return;
  }

  broadcast('plan_created', {
    task_id,
    milestone_count: plan.milestones.length,
    total_estimated_cost: plan.total_estimated_cost,
    reasoning: plan.reasoning,
    milestones: plan.milestones,
    selected_agent_id: plan.selected_agent_id,
  });

  // Await user plan approval
  try {
    await waitForApproval(task_id, {
      task_id,
      task,
      reasoning: plan.reasoning,
      total_estimated_cost: plan.total_estimated_cost,
      milestones: plan.milestones,
      auto_approve_in_ms: APPROVAL_TIMEOUT_MS,
    });
  } catch (err: any) {
    broadcast('task_error', { task_id, task, error: `Plan rejected: ${err.message}` });
    return;
  }

  if (userAddress) {
    activityStore.append({
      user_address: userAddress,
      event: 'task_started',
      task_id,
      task_description: task,
    });
  }

  const executor = new PlanExecutor(agents);

  executor.on('escrow_deployed', data => {
    broadcast('escrow_deployed', { task_id, ...data });
    if (userAddress && data.contract_id) {
      activityStore.append({
        user_address: userAddress,
        event: 'escrow_deployed',
        task_id,
        task_description: task,
        escrow_contract_id: data.contract_id,
      });
      appendEscrowTx({
        user_address: userAddress,
        type: 'deploy',
        escrow_contract_id: data.contract_id,
        tx_hash: data.tx_hash,
        task_id,
      });
    }
  });

  executor.on('funding_required', data => {
    broadcast('funding_required', { task_id, ...data });
    // Dashboard will prompt user to fund; user confirms via /api/tasks/:id/fund-confirm
  });

  executor.on('task_started', data => broadcast('task_started', data));
  executor.on('milestone_started', data => broadcast('milestone_started', data));
  executor.on('agent_output', data => broadcast('agent_output', data));
  executor.on('milestone_marked', data => broadcast('milestone_marked', data));
  executor.on('verifying', data => broadcast('verifying', data));
  executor.on('verified', data => broadcast('verified', data));
  executor.on('milestone_released', data => {
    broadcast('milestone_released', data);
    if (userAddress && data.tx_hash) {
      activityStore.append({
        user_address: userAddress,
        event: 'milestone_released',
        task_id,
        task_description: task,
        amount_usdc: data.amount,
        milestone_index: data.milestone_index,
      });
    }
  });
  executor.on('milestone_rejected', data => broadcast('milestone_rejected', data));
  executor.on('milestone_failed', data => broadcast('milestone_failed', data));
  executor.on('dispute_started', data => broadcast('dispute_started', data));
  executor.on('dispute_resolved', data => broadcast('dispute_resolved', data));
  executor.on('task_complete', data => broadcast('task_complete', data));

  // Wire executor's funding_required to the funding gate
  executor.on('funding_required', () => {
    // Don't block — just broadcast. In auto-demo mode, resolve immediately.
    // In real usage, /api/tasks/:id/fund-confirm resolves the gate.
    const pending = pendingFunding.get(task_id);
    if (!pending) {
      // Create a self-resolving gate for this task
      // The funding gate was already established above; we need to hook it up
    }
  });

  try {
    const result = await executor.execute(plan, task, REGISTRY_URL, userAddress, {
      humanOverride: options.humanOverride?.approver || options.humanOverride?.disputeResolver
        ? options.humanOverride
        : undefined,
    });

    broadcast('task_result', result);
    console.log(`[Orchestrator] Task ${result.task_id} ${result.status} | cost: $${result.total_cost.toFixed(4)} | ${result.total_time_ms}ms`);

    if (userAddress) {
      activityStore.append({
        user_address: userAddress,
        event: 'task_completed',
        task_id,
        task_description: task,
        amount_usdc: result.total_cost,
      });
      saveTaskResult(userAddress, task, result);
    }
  } catch (err: any) {
    broadcast('task_error', { task_id, task, error: `Execution failed: ${err.message}` });
    if (userAddress) {
      activityStore.append({
        user_address: userAddress,
        event: 'task_failed',
        task_id,
        task_description: task,
      });
    }
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

const server = createServer(app);

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`[Conductor] Orchestrator running on port ${PORT}`);
  console.log(`[Conductor] Platform wallet: ${PLATFORM_ADDRESS}`);
  console.log(`[Conductor] Registry: ${REGISTRY_URL}`);
  console.log(`[Conductor] WebSocket: ws://localhost:${PORT}/ws`);
});
