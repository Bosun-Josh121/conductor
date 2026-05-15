import { useState } from 'react';
import { AlertTriangle, CheckCircle, X, ExternalLink, DollarSign, Zap } from 'lucide-react';
import { useWallet } from '../contexts/WalletProvider';
import { confirmFunding } from '../lib/api';

interface Props {
  taskId: string;
  contractId: string;
  viewerUrl: string;
  totalUsdc: number;
  fundXdr?: string;
  funderAddress?: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function FundingPrompt({ taskId, contractId, viewerUrl, totalUsdc, fundXdr, onConfirm, onDismiss }: Props) {
  const { signTransaction } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fund = async (mode: 'freighter' | 'platform') => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'freighter') {
        if (!fundXdr) throw new Error('No unsigned transaction available — try platform funds instead.');
        const signedXdr = await signTransaction(fundXdr, 'Test SDF Network ; September 2015');
        if (!signedXdr) throw new Error('Freighter returned empty signed transaction.');
        await confirmFunding(taskId, { signedXdr });
      } else {
        await confirmFunding(taskId, { usePlatformFunds: true });
      }
      onConfirm();
    } catch (err: any) {
      setError(err.message ?? 'Failed');
    } finally {
      setBusy(false);
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
              <p className="text-xs text-gray-500">Your USDC locks until agents deliver</p>
            </div>
          </div>
          <button onClick={onDismiss} disabled={busy} className="text-gray-600 hover:text-gray-400 disabled:opacity-40">
            <X size={14} />
          </button>
        </div>

        {/* Amount */}
        <div className="bg-amber-950/30 border border-amber-900/40 rounded-xl px-4 py-3 text-center">
          <p className="text-2xl font-bold text-white">
            {totalUsdc.toFixed(4)} <span className="text-amber-400">USDC</span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5">locked in escrow — released per milestone on verification</p>
        </div>

        {/* Guarantees */}
        <div className="space-y-1.5">
          {[
            'Funds locked in a Trustless Work smart contract on Stellar',
            'Agents paid only when AI Verifier confirms acceptance criteria',
            'Disputed or failed milestone funds return to platform',
          ].map((line, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-gray-500">
              <CheckCircle size={9} className="text-emerald-500 mt-0.5 shrink-0" />
              {line}
            </div>
          ))}
        </div>

        {/* Contract ID */}
        <div className="bg-gray-950/60 rounded-lg px-3 py-2 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-gray-600 mb-0.5">Escrow contract</p>
            <p className="text-xs text-gray-400 font-mono truncate">{contractId}</p>
          </div>
          {viewerUrl && (
            <a href={viewerUrl} target="_blank" rel="noreferrer"
              className="shrink-0 text-violet-400 hover:text-violet-300 transition-colors">
              <ExternalLink size={12} />
            </a>
          )}
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-950/40 rounded-lg px-3 py-2 leading-relaxed">{error}</p>
        )}

        {/* Primary action: Freighter */}
        <button
          onClick={() => fund('freighter')}
          disabled={busy || !fundXdr}
          className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
        >
          {busy ? (
            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <CheckCircle size={12} />
          )}
          {busy ? 'Processing…' : `Fund ${totalUsdc.toFixed(4)} USDC with Freighter`}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-[10px] text-gray-700">or for testing</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        {/* Demo fallback: platform funds */}
        <button
          onClick={() => fund('platform')}
          disabled={busy}
          className="w-full py-2 rounded-xl border border-gray-700 hover:border-gray-500 disabled:opacity-40 text-gray-400 hover:text-gray-200 text-xs transition-colors flex items-center justify-center gap-1.5"
        >
          <Zap size={10} className="text-gray-600" />
          Use Platform Funds (demo / test mode)
        </button>

        <p className="text-[10px] text-gray-700 text-center">
          Need testnet USDC for Freighter?{' '}
          <a href="https://faucet.circle.com" target="_blank" rel="noreferrer"
            className="text-amber-600 underline">Circle faucet
          </a>
          {' '}→ select Stellar → paste your address
        </p>

        <button
          onClick={onDismiss}
          disabled={busy}
          className="w-full py-1.5 text-xs text-gray-700 hover:text-gray-500 disabled:opacity-40 transition-colors"
        >
          Cancel task
        </button>
      </div>
    </div>
  );
}
