import { Zap, CheckCircle, X } from 'lucide-react';

export interface PendingPlan {
  task_id: string;
  task: string;
  reasoning: string;
  total_estimated_cost: number;
  milestones: Array<{ title: string; description: string; amount: number }>;
  auto_approve_in_ms: number;
}

interface Props {
  plan: PendingPlan;
  onApprove: () => void;
  onReject: () => void;
  onDismiss: () => void;
}

export function PlanApproval({ plan, onApprove, onReject, onDismiss }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-violet-400" />
            <h2 className="text-sm font-semibold text-white">Review Execution Plan</h2>
          </div>
          <button onClick={onDismiss} className="text-gray-600 hover:text-gray-400"><X size={14} /></button>
        </div>

        <div className="bg-gray-950/60 rounded-lg p-3 text-xs text-gray-400">
          <p className="font-medium text-gray-300 mb-1">Task</p>
          <p>{plan.task}</p>
        </div>

        <div className="bg-gray-950/60 rounded-lg p-3 text-xs text-gray-400">
          <p className="font-medium text-gray-300 mb-1">Reasoning</p>
          <p>{plan.reasoning}</p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-300">Milestones ({plan.milestones?.length ?? 0})</p>
          <div className="max-h-60 overflow-y-auto space-y-2 pr-0.5">
          {(plan.milestones ?? []).map((m, i) => (
            <div key={i} className="bg-gray-950/60 rounded-lg p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-gray-200">{m.title}</p>
                <p className="text-xs text-gray-500 shrink-0">${m.amount?.toFixed(4)}</p>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{m.description}</p>
            </div>
          ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-800 pt-3">
          <p className="text-sm text-gray-300">
            Total: <span className="font-bold text-white">${plan.total_estimated_cost?.toFixed(4)} USDC</span>
          </p>
          <div className="flex gap-2">
            <button
              onClick={onReject}
              className="px-3 py-1.5 rounded-lg text-xs border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
            >
              Reject
            </button>
            <button
              onClick={onApprove}
              className="px-3 py-1.5 rounded-lg text-xs bg-violet-700 hover:bg-violet-600 text-white font-semibold transition-colors flex items-center gap-1"
            >
              <CheckCircle size={10} />
              Approve & Deploy Escrow
            </button>
          </div>
        </div>

        <p className="text-xs text-gray-700 text-center">
          Auto-approves in {Math.round((plan.auto_approve_in_ms ?? 60000) / 1000)}s if no action taken
        </p>
      </div>
    </div>
  );
}
