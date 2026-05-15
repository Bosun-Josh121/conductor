import { AlertTriangle, ExternalLink, CheckCircle, X } from 'lucide-react';

interface Props {
  taskId: string;
  contractId: string;
  viewerUrl: string;
  totalUsdc: number;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function FundingPrompt({ contractId, viewerUrl, totalUsdc, onConfirm, onDismiss }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-gray-900 border border-amber-900/40 rounded-2xl p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-white">Fund the Escrow</h2>
          </div>
          <button onClick={onDismiss} className="text-gray-600 hover:text-gray-400"><X size={14} /></button>
        </div>

        <p className="text-xs text-gray-400 leading-relaxed">
          The escrow has been deployed. Send <span className="text-white font-bold">{totalUsdc.toFixed(7)} USDC</span> to the escrow contract to unlock execution. This is the only transaction you sign.
        </p>

        <div className="bg-gray-950/60 rounded-lg p-3 space-y-1">
          <p className="text-xs text-gray-600">Contract ID</p>
          <p className="text-xs text-gray-300 font-mono break-all">{contractId}</p>
        </div>

        <div className="space-y-2">
          {viewerUrl && (
            <a
              href={viewerUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-900/40 text-xs text-amber-400 hover:bg-amber-950/40 transition-colors"
            >
              <ExternalLink size={10} />
              Open in Trustless Work Escrow Viewer
            </a>
          )}
          <p className="text-xs text-gray-600 text-center">
            Fund the escrow in the Escrow Viewer or Freighter, then click below.
          </p>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onDismiss}
            className="flex-1 px-3 py-2 rounded-lg text-xs border border-gray-700 text-gray-400 hover:text-white transition-colors"
          >
            Cancel Task
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-3 py-2 rounded-lg text-xs bg-amber-700 hover:bg-amber-600 text-white font-semibold transition-colors flex items-center justify-center gap-1"
          >
            <CheckCircle size={10} />
            I've Funded It
          </button>
        </div>
      </div>
    </div>
  );
}
