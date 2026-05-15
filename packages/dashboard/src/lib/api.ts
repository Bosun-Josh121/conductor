const BASE = '';

export async function submitTask(task: string, budget: number, userAddress?: string, options?: {
  humanOverrideApprover?: string;
  humanOverrideResolver?: string;
}) {
  const res = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task,
      budget,
      user_address: userAddress,
      human_override_approver: options?.humanOverrideApprover,
      human_override_resolver: options?.humanOverrideResolver,
    }),
  });
  return res.json();
}

export async function confirmFunding(taskId: string, signedXdr?: string) {
  const res = await fetch(`${BASE}/api/tasks/${taskId}/fund-confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Funding failed');
  return data;
}

export async function fetchAgents() {
  const res = await fetch(`${BASE}/api/agents`);
  const data = await res.json();
  return data.agents ?? [];
}

export async function fetchWallets() {
  const res = await fetch(`${BASE}/api/wallets`);
  return res.json();
}

export async function approveTask(task_id: string) {
  const res = await fetch(`${BASE}/api/tasks/${task_id}/approve`, { method: 'POST' });
  return res.json();
}

export async function rejectTask(task_id: string) {
  const res = await fetch(`${BASE}/api/tasks/${task_id}/reject`, { method: 'POST' });
  return res.json();
}

export async function fetchEscrow(contractId: string) {
  const res = await fetch(`${BASE}/api/escrow/${encodeURIComponent(contractId)}`);
  return res.json();
}

export async function submitSignedXdr(signedXdr: string) {
  const res = await fetch(`${BASE}/api/escrow/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signed_xdr: signedXdr }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Submit failed');
  return data;
}

export async function fetchUsdcTrustlineXdr(userAddress: string): Promise<string> {
  const res = await fetch(`${BASE}/api/usdc-trustline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_address: userAddress }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Failed to build XDR');
  return data.xdr;
}

export async function registerAgent(manifest: any) {
  const res = await fetch(`${BASE}/api/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  return res.json();
}

export async function fetchActivity(userAddress: string) {
  const res = await fetch(`${BASE}/api/activity/${userAddress}`);
  const data = await res.json();
  return data.events ?? [];
}

export async function fetchPulse() {
  const res = await fetch(`${BASE}/api/stats/pulse`);
  return res.json();
}

export async function renameAgent(agent_id: string, name: string, requester_address: string) {
  const res = await fetch(`${BASE}/api/agents/${encodeURIComponent(agent_id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, requester_address }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Rename failed');
  return data;
}

export async function deleteAgent(agent_id: string, requester_address: string) {
  const res = await fetch(`/api/agents/${encodeURIComponent(agent_id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requester_address }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? 'Delete failed');
  return true;
}

export async function fetchEscrowLedger(userAddress: string) {
  const res = await fetch(`${BASE}/api/escrow-ledger/${encodeURIComponent(userAddress)}`);
  const data = await res.json();
  return data.entries ?? [];
}

export async function fetchTaskHistory(userAddress: string) {
  const res = await fetch(`${BASE}/api/tasks/history/${encodeURIComponent(userAddress)}`);
  const data = await res.json();
  return data.results ?? [];
}

export async function deleteTaskHistory(taskId: string, userAddress: string): Promise<boolean> {
  const res = await fetch(
    `${BASE}/api/tasks/history/${encodeURIComponent(taskId)}?user_address=${encodeURIComponent(userAddress)}`,
    { method: 'DELETE' },
  );
  return res.ok;
}

export async function humanApproveMilestone(taskId: string, milestoneIndex: number, signedXdr: string) {
  const res = await fetch(`${BASE}/api/tasks/${taskId}/milestones/${milestoneIndex}/human-approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signedXdr }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Approval failed');
  return data;
}

export async function humanRejectMilestone(taskId: string, milestoneIndex: number) {
  const res = await fetch(`${BASE}/api/tasks/${taskId}/milestones/${milestoneIndex}/human-reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Rejection failed');
  return data;
}

export async function previewTask(task: string, budget: number) {
  const res = await fetch(`${BASE}/api/tasks/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, budget }),
  });
  return res.json();
}
