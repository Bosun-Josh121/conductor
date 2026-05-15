import { ExternalLink, Shield } from 'lucide-react';
import type { WSEvent } from '../hooks/useWebSocket';

interface Props {
  events: WSEvent[];
}

export function EscrowPanel({ events }: Props) {
  const deployEvent = events.find(e => e.event === 'escrow_deployed');
  const taskResult  = events.find(e => e.event === 'task_result')?.data;
  const contractId  = deployEvent?.data?.contract_id || taskResult?.escrow_contract_id;
  const viewerUrl   = deployEvent?.data?.viewer_url || taskResult?.escrow_viewer_url;
  const deployTx    = deployEvent?.data?.tx_hash;

  if (!contractId) return null;

  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Shield size={11} className="text-violet-500" />
        <h2 className="text-xs font-semibold text-gray-300">Escrow</h2>
      </div>

      <div className="space-y-1.5">
        <div>
          <p className="text-xs text-gray-600">Contract ID</p>
          <p className="text-xs text-gray-400 font-mono break-all">{contractId}</p>
        </div>

        {deployTx && (
          <div>
            <p className="text-xs text-gray-600">Deploy TX</p>
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${deployTx}`}
              target="_blank" rel="noreferrer"
              className="text-xs text-gray-500 hover:text-gray-300 font-mono flex items-center gap-0.5"
            >
              {deployTx.slice(0, 16)}… <ExternalLink size={8} />
            </a>
          </div>
        )}

        {viewerUrl && (
          <a
            href={viewerUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-900/30 border border-violet-800/40 text-xs text-violet-400 hover:bg-violet-900/50 transition-colors"
          >
            <ExternalLink size={9} />
            View in Escrow Viewer
          </a>
        )}
      </div>
    </div>
  );
}
