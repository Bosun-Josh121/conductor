import { CheckCircle, XCircle, Clock, ExternalLink, Shield } from 'lucide-react';
import type { WSEvent } from '../hooks/useWebSocket';

interface MilestoneState {
  index: number;
  title: string;
  agent: string;
  status: 'running' | 'approved' | 'rejected' | 'released' | 'disputed' | 'resolved';
  verifierReasoning?: string;
  verifierPassed?: boolean;
  releaseTx?: string;
  disputeResolution?: { agent_pct: number; funder_pct: number; reasoning: string };
  output?: string;
}

interface Props {
  events: WSEvent[];
}

export function MilestonePanel({ events }: Props) {
  // Build milestone state from events
  const milestoneMap = new Map<number, MilestoneState>();

  for (const e of [...events].reverse()) {
    const idx = e.data?.milestone_index;
    if (idx == null) continue;

    if (!milestoneMap.has(idx)) {
      milestoneMap.set(idx, {
        index: idx,
        title: e.data?.title ?? `Milestone ${idx}`,
        agent: e.data?.agent ?? '',
        status: 'running',
      });
    }
    const ms = milestoneMap.get(idx)!;

    if (e.event === 'milestone_started') {
      ms.title = e.data?.title ?? ms.title;
      ms.agent = e.data?.agent ?? ms.agent;
    }
    if (e.event === 'agent_output') ms.output = e.data?.output_preview;
    if (e.event === 'verified') {
      ms.verifierPassed = e.data?.passed;
      ms.verifierReasoning = e.data?.reasoning;
      ms.status = e.data?.passed ? 'approved' : 'rejected';
    }
    if (e.event === 'milestone_released') {
      ms.status = 'released';
      ms.releaseTx = e.data?.tx_hash;
    }
    if (e.event === 'dispute_started') ms.status = 'disputed';
    if (e.event === 'dispute_resolved') {
      ms.status = 'resolved';
      ms.disputeResolution = e.data?.resolution;
    }
  }

  const milestones = [...milestoneMap.values()].sort((a, b) => a.index - b.index);

  // Also show plan milestones if available
  const planEvent = events.find(e => e.event === 'plan_created');
  const planMilestones: Array<{ title: string; description: string; amount: number }> = planEvent?.data?.milestones ?? [];

  const taskResult = events.find(e => e.event === 'task_result')?.data;

  if (milestones.length === 0 && planMilestones.length === 0 && !taskResult) return null;

  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Shield size={11} className="text-violet-500" />
        <h2 className="text-xs font-semibold text-gray-300">Milestones</h2>
        {taskResult?.escrow_viewer_url && (
          <a
            href={taskResult.escrow_viewer_url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-violet-400 hover:text-violet-300 flex items-center gap-0.5"
          >
            Escrow Viewer <ExternalLink size={9} />
          </a>
        )}
      </div>

      {/* If task result available, show final summary */}
      {taskResult && (
        <div className={`rounded-lg px-3 py-2 text-xs border ${
          taskResult.status === 'complete'
            ? 'bg-emerald-950/40 border-emerald-900/40 text-emerald-400'
            : taskResult.status === 'partial'
            ? 'bg-amber-950/40 border-amber-900/40 text-amber-400'
            : 'bg-red-950/40 border-red-900/40 text-red-400'
        }`}>
          Status: {taskResult.status} · Total: ${taskResult.total_cost?.toFixed(4)} USDC · {taskResult.total_time_ms ? `${(taskResult.total_time_ms / 1000).toFixed(0)}s` : ''}
        </div>
      )}

      {/* Plan milestones (before execution) */}
      {planMilestones.length > 0 && milestones.length === 0 && (
        <div className="space-y-2">
          {planMilestones.map((m, i) => (
            <div key={i} className="border border-gray-800/60 rounded-lg p-2.5 space-y-1">
              <div className="flex items-center gap-2">
                <Clock size={9} className="text-gray-600" />
                <span className="text-xs text-gray-300 font-medium">{m.title}</span>
                <span className="ml-auto text-xs text-gray-600">${m.amount?.toFixed(4)}</span>
              </div>
              <p className="text-xs text-gray-600 line-clamp-2">{m.description}</p>
            </div>
          ))}
        </div>
      )}

      {/* Live milestone execution */}
      {milestones.map(ms => (
        <div key={ms.index} className={`border rounded-lg p-2.5 space-y-1.5 ${
          ms.status === 'released' ? 'border-emerald-900/40 bg-emerald-950/20' :
          ms.status === 'rejected' || ms.status === 'disputed' ? 'border-red-900/40 bg-red-950/20' :
          ms.status === 'resolved' ? 'border-violet-900/40 bg-violet-950/20' :
          'border-gray-800/60'
        }`}>
          <div className="flex items-center gap-2">
            {ms.status === 'released' ? <CheckCircle size={10} className="text-emerald-400" /> :
             ms.status === 'rejected' || ms.status === 'disputed' ? <XCircle size={10} className="text-red-400" /> :
             ms.status === 'approved' ? <CheckCircle size={10} className="text-blue-400" /> :
             ms.status === 'resolved' ? <Shield size={10} className="text-violet-400" /> :
             <Clock size={10} className="text-amber-400 animate-spin" />}
            <span className="text-xs text-gray-200 font-medium">M{ms.index}: {ms.title}</span>
            <span className="ml-auto text-xs text-gray-600">{ms.agent}</span>
          </div>

          {ms.verifierReasoning && (
            <div className={`text-xs px-2 py-1 rounded ${ms.verifierPassed ? 'text-emerald-400 bg-emerald-950/40' : 'text-red-400 bg-red-950/40'}`}>
              <span className="font-medium">{ms.verifierPassed ? '✓ Approved' : '✗ Rejected'}: </span>
              {ms.verifierReasoning.slice(0, 150)}
            </div>
          )}

          {ms.disputeResolution && (
            <div className="text-xs text-violet-400 bg-violet-950/40 px-2 py-1 rounded">
              <span className="font-medium">Arbiter resolved: </span>
              Agent {ms.disputeResolution.agent_pct}% · Funder {ms.disputeResolution.funder_pct}%
              <p className="text-violet-500 mt-0.5">{ms.disputeResolution.reasoning?.slice(0, 100)}</p>
            </div>
          )}

          {ms.releaseTx && (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${ms.releaseTx}`}
              target="_blank" rel="noreferrer"
              className="text-xs text-gray-600 hover:text-gray-400 flex items-center gap-0.5"
            >
              TX: {ms.releaseTx.slice(0, 16)}… <ExternalLink size={8} />
            </a>
          )}
        </div>
      ))}

      {/* Final output */}
      {taskResult?.final_output && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500 font-medium">Final Output</p>
          <div className="bg-gray-950/60 rounded-lg p-2.5 text-xs text-gray-300 max-h-40 overflow-y-auto whitespace-pre-wrap">
            {taskResult.final_output}
          </div>
        </div>
      )}
    </div>
  );
}
