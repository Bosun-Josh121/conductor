import { useState } from 'react';
import { Music } from 'lucide-react';
import { useWallet } from '../contexts/WalletProvider';

export function ConnectWallet() {
  const { connect } = useWallet();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await connect();
    } catch (err: any) {
      setError(err.message ?? 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-violet-600 to-indigo-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-900/40">
            <Music size={22} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Conductor</h1>
          <p className="text-sm text-gray-500 mt-1">AI Task Marketplace · Trustless Work Escrow</p>
        </div>

        <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-4 mb-6 space-y-2">
          <p className="text-xs text-gray-400 leading-relaxed">
            Post a task with a USDC budget. AI agents do the work. An{' '}
            <span className="text-violet-400 font-medium">AI Verifier</span> holds the escrow
            Approver role and signs milestone approvals on-chain. An{' '}
            <span className="text-violet-400 font-medium">AI Arbiter</span> resolves disputes —
            no human needed.
          </p>
          <p className="text-xs text-gray-600">
            Requires <a href="https://www.freighter.app" target="_blank" rel="noreferrer" className="text-violet-400 underline">Freighter</a> browser extension on <strong className="text-gray-500">Stellar Testnet</strong>.
          </p>
        </div>

        <button
          onClick={handleConnect}
          disabled={connecting}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white font-semibold transition-colors"
        >
          {connecting ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {connecting ? 'Connecting…' : 'Connect Freighter Wallet'}
        </button>

        {error && (
          <div className="mt-3 text-xs text-red-400 text-center bg-red-950/40 rounded-lg p-2">
            {error.includes('not installed') || error.includes('could not be reached')
              ? <>Freighter not found. <a href="https://www.freighter.app" target="_blank" rel="noreferrer" className="underline text-red-300">Install it here</a> then refresh.</>
              : error}
          </div>
        )}

        <p className="text-xs text-gray-700 text-center mt-4">
          Make sure Freighter is set to <strong className="text-gray-600">Testnet</strong> before connecting.
        </p>
      </div>
    </div>
  );
}
