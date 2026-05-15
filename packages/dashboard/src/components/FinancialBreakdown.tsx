import { ExternalLink, DollarSign } from 'lucide-react';
import type { WSEvent } from '../hooks/useWebSocket';

interface Props {
  events: WSEvent[];
}

export function FinancialBreakdown({ events }: Props) {
  const taskResult = events.find(e => e.event === 'task_result')?.data;
  const planEvent  = events.find(e => e.event === 'plan_created')?.data;

  if (!taskResult) return null;

  const milestones: any[] = taskResult.milestones ?? [];
  const planMilestones: any[] = planEvent?.milestones ?? [];

  // Build per-milestone financial rows
  const rows = milestones.map((ms: any) => {
    const plan = planMilestones[ms.milestone_index] ?? {};
    const budgeted: number = plan.amount ?? 0;

    let paid = 0;
    let recipient = ms.agent_name ?? '—';
    let paidTo = 'agent';
    let txHash: string | undefined;
    let method = 'released';

    if (ms.dispute_resolution) {
      const agentShare = budgeted * ms.dispute_resolution.agent_pct / 100;
      const funderShare = budgeted * ms.dispute_resolution.funder_pct / 100;
      paid = agentShare;
      paidTo = `${ms.dispute_resolution.agent_pct}% agent · ${ms.dispute_resolution.funder_pct}% returned`;
      method = 'dispute resolved';
      txHash = ms.tx_hashes?.dispute_resolve;
      return { index: ms.milestone_index, title: ms.title, agent: ms.agent_name, budgeted, agentPaid: agentShare, funderPaid: funderShare, paidTo, method, txHash, success: ms.success };
    }

    if (ms.tx_hashes?.release) {
      paid = budgeted;
      txHash = ms.tx_hashes.release;
      return { index: ms.milestone_index, title: ms.title, agent: ms.agent_name, budgeted, agentPaid: budgeted, funderPaid: 0, paidTo: 'agent', method: 'released', txHash, success: ms.success };
    }

    return { index: ms.milestone_index, title: ms.title, agent: ms.agent_name, budgeted, agentPaid: 0, funderPaid: 0, paidTo: '—', method: ms.error ? 'failed' : '—', txHash: undefined, success: false };
  });

  const totalBudgeted = rows.reduce((s, r) => s + r.budgeted, 0);
  const totalAgentPaid = rows.reduce((s, r) => s + r.agentPaid, 0);
  const totalReturned = rows.reduce((s, r) => s + r.funderPaid, 0);

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
        <DollarSign size={9} className="text-emerald-600" />
        Fund Distribution
      </p>

      <div className="rounded-xl border border-gray-800/60 overflow-hidden">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="bg-gray-900/80 border-b border-gray-800/60">
              <th className="text-left px-3 py-2 text-gray-500 font-medium">Milestone</th>
              <th className="text-right px-3 py-2 text-gray-500 font-medium">Budget</th>
              <th className="text-right px-3 py-2 text-gray-500 font-medium">Agent paid</th>
              <th className="text-right px-3 py-2 text-gray-500 font-medium">Returned</th>
              <th className="text-right px-3 py-2 text-gray-500 font-medium">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.index} className="border-b border-gray-900 hover:bg-gray-900/30">
                <td className="px-3 py-2">
                  <p className="text-gray-300 font-medium">M{row.index}: {row.title}</p>
                  <p className="text-gray-600">{row.agent} · {row.method}</p>
                </td>
                <td className="px-3 py-2 text-right text-gray-400 tabular-nums">
                  ${row.budgeted.toFixed(4)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className={row.agentPaid > 0 ? 'text-emerald-400' : 'text-gray-700'}>
                    ${row.agentPaid.toFixed(4)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className={row.funderPaid > 0 ? 'text-amber-400' : 'text-gray-700'}>
                    ${row.funderPaid.toFixed(4)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {row.txHash ? (
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${row.txHash}`}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-0.5 text-violet-400 hover:text-violet-300"
                      title={row.txHash}
                    >
                      {row.txHash.slice(0, 8)}… <ExternalLink size={8} />
                    </a>
                  ) : (
                    <span className="text-gray-800">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-900/60 border-t border-gray-800">
              <td className="px-3 py-2 text-gray-400 font-semibold">Total</td>
              <td className="px-3 py-2 text-right text-gray-400 tabular-nums font-semibold">
                ${totalBudgeted.toFixed(4)}
              </td>
              <td className="px-3 py-2 text-right text-emerald-400 tabular-nums font-semibold">
                ${totalAgentPaid.toFixed(4)}
              </td>
              <td className="px-3 py-2 text-right text-amber-400 tabular-nums font-semibold">
                ${totalReturned.toFixed(4)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex gap-4 px-1 text-[10px] text-gray-600">
        <span><span className="text-emerald-400 font-medium">${totalAgentPaid.toFixed(4)}</span> paid to agents</span>
        {totalReturned > 0 && <span><span className="text-amber-400 font-medium">${totalReturned.toFixed(4)}</span> returned to platform</span>}
        <span><span className="text-gray-400 font-medium">${totalBudgeted.toFixed(4)}</span> total locked</span>
      </div>
    </div>
  );
}
