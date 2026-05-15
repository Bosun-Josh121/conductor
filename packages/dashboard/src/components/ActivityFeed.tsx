import { Activity, X, CheckCircle, XCircle, Clock, Zap, Shield, AlertTriangle } from 'lucide-react';
import type { WSEvent } from '../hooks/useWebSocket';

const EVENT_ICONS: Record<string, React.ReactNode> = {
  task_started:      <Zap size={9} className="text-violet-400" />,
  plan_created:      <Zap size={9} className="text-blue-400" />,
  escrow_deployed:   <Shield size={9} className="text-emerald-400" />,
  escrow_funded:     <Shield size={9} className="text-emerald-400" />,
  funding_required:  <AlertTriangle size={9} className="text-amber-400" />,
  milestone_started: <Clock size={9} className="text-blue-400" />,
  verifying:         <Shield size={9} className="text-violet-400" />,
  verified:          <CheckCircle size={9} className="text-emerald-400" />,
  milestone_released:<CheckCircle size={9} className="text-emerald-400" />,
  milestone_rejected:<XCircle size={9} className="text-red-400" />,
  dispute_started:   <AlertTriangle size={9} className="text-amber-400" />,
  dispute_resolved:  <Shield size={9} className="text-violet-400" />,
  task_complete:     <CheckCircle size={9} className="text-emerald-400" />,
  task_error:        <XCircle size={9} className="text-red-400" />,
  task_result:       <CheckCircle size={9} className="text-emerald-400" />,
};

function eventLabel(event: string, data: any): string {
  switch (event) {
    case 'task_accepted':    return `Task accepted — budget $${data?.budget?.toFixed(2) ?? '?'}`;
    case 'agents_loaded':    return `${data?.count ?? 0} agents available`;
    case 'feasibility_checked': return `Feasibility: ${data?.feasible ? 'OK' : 'FAILED'}`;
    case 'plan_created':     return `Plan created — ${data?.milestone_count ?? 0} milestones, $${data?.total_estimated_cost?.toFixed(4) ?? '?'} USDC`;
    case 'plan_approval_required': return `Plan ready for review (auto-approves in ${Math.round((data?.auto_approve_in_ms ?? 60000) / 1000)}s)`;
    case 'plan_approved':    return 'Plan approved — deploying escrow';
    case 'plan_auto_approved': return 'Plan auto-approved';
    case 'escrow_deploying': return `Deploying escrow for agent: ${data?.agent ?? '?'}`;
    case 'escrow_deployed':  return `Escrow deployed: ${data?.contract_id?.slice(0, 16) ?? '?'}…`;
    case 'funding_required': return `Fund escrow with ${data?.total_usdc?.toFixed(4) ?? '?'} USDC`;
    case 'escrow_funded':    return 'Escrow funded — starting execution';
    case 'task_started':     return `Starting execution: ${data?.milestone_count ?? 0} milestones`;
    case 'milestone_started': return `[M${data?.milestone_index ?? '?'}] Starting: ${data?.title ?? ''} → ${data?.agent ?? ''}`;
    case 'agent_output':     return `[M${data?.milestone_index ?? '?'}] Agent output received`;
    case 'milestone_marked': return `[M${data?.milestone_index ?? '?'}] Marked done on-chain`;
    case 'verifying':        return `[M${data?.milestone_index ?? '?'}] AI Verifier evaluating…`;
    case 'verified':         return `[M${data?.milestone_index ?? '?'}] Verifier: ${data?.passed ? '✓ PASSED' : '✗ REJECTED'} — see Milestones panel for details`;
    case 'milestone_released': return `[M${data?.milestone_index ?? '?'}] Released $${data?.amount?.toFixed(4) ?? '?'} USDC to agent`;
    case 'milestone_rejected': return `[M${data?.milestone_index ?? '?'}] Rejected — disputing…`;
    case 'dispute_started':  return `[M${data?.milestone_index ?? '?'}] Dispute opened`;
    case 'dispute_resolved': return `[M${data?.milestone_index ?? '?'}] Arbiter: Agent ${data?.resolution?.agent_pct ?? '?'}% · Funder ${data?.resolution?.funder_pct ?? '?'}% — see Milestones panel`;
    case 'task_complete':    return `Task ${data?.status ?? 'done'} — $${data?.total_cost?.toFixed(4) ?? '?'} spent`;
    case 'task_result':      return `Result: ${data?.status ?? '?'} — $${data?.total_cost?.toFixed(4) ?? '?'} | ${data?.escrow_viewer_url ? 'View escrow ↗' : ''}`;
    case 'task_error':       return `Error: ${data?.error ?? 'unknown'}`;
    case 'task_infeasible':  return `Infeasible: missing ${(data?.missing ?? []).join(', ')}`;
    default:                 return event.replace(/_/g, ' ');
  }
}

function eventColor(event: string): string {
  if (['task_error', 'task_infeasible', 'milestone_rejected', 'step_failed'].includes(event)) return 'text-red-400';
  if (['task_result', 'task_complete', 'milestone_released', 'verified'].includes(event)) return 'text-emerald-400';
  if (['funding_required', 'dispute_started', 'milestone_rejected'].includes(event)) return 'text-amber-400';
  if (['plan_created', 'escrow_deployed', 'plan_approved'].includes(event)) return 'text-blue-400';
  return 'text-gray-400';
}

interface Props {
  events: WSEvent[];
  connected: boolean;
  onClear: () => void;
}

export function ActivityFeed({ events, connected, onClear }: Props) {
  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={11} className="text-violet-500" />
          <h2 className="text-xs font-semibold text-gray-300">Live Activity</h2>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-500 animate-pulse'}`} />
        </div>
        {events.length > 0 && (
          <button onClick={onClear} className="text-gray-700 hover:text-gray-500">
            <X size={10} />
          </button>
        )}
      </div>

      <div className="space-y-1 max-h-80 overflow-y-auto">
        {events.length === 0 ? (
          <p className="text-xs text-gray-700 text-center py-4">Waiting for activity…</p>
        ) : (
          events.slice(0, 60).map((e, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="shrink-0 mt-0.5">{EVENT_ICONS[e.event] ?? <Activity size={9} className="text-gray-700" />}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-xs leading-tight break-words ${eventColor(e.event)}`}>
                  {eventLabel(e.event, e.data)}
                </p>
                {e.event === 'task_result' && e.data?.escrow_viewer_url && (
                  <a
                    href={e.data.escrow_viewer_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-violet-400 hover:text-violet-300 underline"
                  >
                    View in Escrow Viewer ↗
                  </a>
                )}
              </div>
              <span className="text-xs text-gray-800 shrink-0 tabular-nums">
                {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
