import { useState } from 'react';
import { AlertTriangle, CheckCircle, X, ExternalLink, DollarSign } from 'lucide-react';
import { useWallet } from '../contexts/WalletProvider';
import { confirmFunding } from '../lib/api';

interface Props {
  taskId: string;
  contractId: string;
  viewerUrl: string;
  totalUsdc: number;
  fundXdr?: string;       // unsigned fundEscrow XDR from TW API
  funderAddress?: string; // user's wallet address
  onConfirm: () => void;
  onDismiss: () => void;
}

export function FundingPrompt({ taskId, contractId, viewerUrl, totalUsdc, fundXdr, onConfirm, onDismiss }: Props) {
  const { signTransaction } = useWallet();
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSign = async () => {
    setSigning(true);
    setError(null);
    try {
      let signedXdr: string | undefined;

      if (fundXdr) {
        // Sign the fundEscrow transaction with Freighter — USDC moves from your wallet
        signedXdr = await signTransaction(fundXdr, 'Test SDF Network ; September 2015');
        if (!signedXdr) throw new Error('Freighter returned empty signed XDR');
      }

      // Submit signed XDR + notify orchestrator to continue
      await confirmFunding(taskId, signedXdr);
      onConfirm();
    } catch (err: any) {
      setError(err.message ?? 'Signing failed');
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-gray-900 border border-amber-900/40 rounded-2xl p-5 space-y-4 shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-amber-600/20 border border-amber-600/40 rounded-md flex items-center justify-center">
              <DollarSign size={12} className="text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Fund the Escrow</p>
              <p className="text-xs text-gray-500">Sign once — Freighter moves your USDC on-chain</p>
            </div>
          </div>
          <button onClick={onDismiss} className="text-gray-600 hover:text-gray-400"><X size={14} /></button>
        </div>

        {/* Amount */}
        <div className="bg-amber-950/30 border border-amber-900/40 rounded-xl px-4 py-3 text-center">
          <p className="text-2xl font-bold text-white">{totalUsdc.toFixed(4)} <span className="text-amber-400">USDC</span></p>
          <p className="text-xs text-gray-500 mt-0.5">locked in escrow until milestones complete</p>
        </div>

        {/* How it works */}
        <div className="space-y-1.5">
          {[
            'Your USDC locks in a Trustless Work smart contract',
            'Agents only get paid when their work passes verification',
            'Unused or rejected funds return to your wallet',
          ].map((line, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-gray-400">
              <CheckCircle size={10} className="text-emerald-500 mt-0.5 shrink-0" />
              {line}
            </div>
          ))}
        </div>

        {/* Contract ID */}
        <div className="bg-gray-950/60 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] text-gray-600 mb-0.5">Escrow contract</p>
            <p className="text-xs text-gray-400 font-mono truncate">{contractId}</p>
          </div>
          {viewerUrl && (
            <a href={viewerUrl} target="_blank" rel="noreferrer" className="shrink-0 text-violet-400 hover:text-violet-300">
              <ExternalLink size={12} />
            </a>
          )}
        </div>

        {/* Need USDC hint */}
        <p className="text-[10px] text-gray-700 text-center">
          Need testnet USDC?{' '}
          <a href="https://dev.trustlesswork.com" target="_blank" rel="noreferrer" className="text-amber-600 underline">
            Get it from the Trustless Work faucet
          </a>
        </p>

        {error && (
          <p className="text-xs text-red-400 bg-red-950/40 rounded-lg px-3 py-2">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onDismiss}
            disabled={signing}
            className="flex-1 px-3 py-2.5 rounded-xl text-xs border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSign}
            disabled={signing}
            className="flex-1 px-3 py-2.5 rounded-xl text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-semibold transition-colors flex items-center justify-center gap-1.5"
          >
            {signing ? (
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <CheckCircle size={12} />
            )}
            {signing ? 'Signing with Freighter…' : `Fund ${totalUsdc.toFixed(4)} USDC`}
          </button>
        </div>
      </div>
    </div>
  );
}
