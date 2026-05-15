import { useState, useEffect } from 'react';
import { History, ExternalLink, Trash2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { useWallet } from '../contexts/WalletProvider';
import { fetchTaskHistory, deleteTaskHistory } from '../lib/api';

export function TaskHistory() {
  const { publicKey } = useWallet();
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!publicKey) return;
    setLoading(true);
    fetchTaskHistory(publicKey).then(setResults).finally(() => setLoading(false));
  }, [publicKey]);

  const handleDelete = async (taskId: string) => {
    if (!publicKey) return;
    await deleteTaskHistory(taskId, publicKey);
    setResults(prev => prev.filter(r => r.task_id !== taskId));
  };

  if (!publicKey) return <p className="text-xs text-gray-600 text-center py-8">Connect a wallet to view history</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <History size={14} className="text-violet-500" />
        <h2 className="text-sm font-semibold text-gray-200">Task History</h2>
        <span className="text-xs text-gray-600">({results.length} tasks)</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : results.length === 0 ? (
        <p className="text-xs text-gray-600 text-center py-8">No completed tasks yet</p>
      ) : (
        <div className="space-y-3">
          {results.map((r: any) => (
            <div key={r.task_id} className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {r.status === 'complete' ? <CheckCircle size={12} className="text-emerald-400 shrink-0" /> :
                   r.status === 'partial' ? <AlertTriangle size={12} className="text-amber-400 shrink-0" /> :
                   <XCircle size={12} className="text-red-400 shrink-0" />}
                  <p className="text-xs text-gray-200 font-medium line-clamp-2">{r.prompt}</p>
                </div>
                <button
                  onClick={() => handleDelete(r.task_id)}
                  className="text-gray-700 hover:text-red-500 shrink-0"
                >
                  <Trash2 size={10} />
                </button>
              </div>

              <div className="flex items-center gap-4 text-xs text-gray-600">
                <span>${r.total_cost?.toFixed(4)} USDC</span>
                <span>{r.milestones?.length ?? 0} milestones</span>
                <span>{new Date(r.timestamp).toLocaleDateString()}</span>
              </div>

              {r.escrow_viewer_url && (
                <a
                  href={r.escrow_viewer_url}
                  target="_blank" rel="noreferrer"
                  className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-0.5"
                >
                  View Escrow <ExternalLink size={8} />
                </a>
              )}

              {r.final_output && (
                <p className="text-xs text-gray-500 line-clamp-2">{r.final_output}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
