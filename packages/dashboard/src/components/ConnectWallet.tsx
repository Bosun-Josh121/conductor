import { useState, useEffect } from 'react';
import { Music, Wallet } from 'lucide-react';
import { useWallet, type ISupportedWallet } from '../contexts/WalletProvider';

export function ConnectWallet() {
  const { connect, getSupportedWallets } = useWallet();
  const [wallets, setWallets] = useState<ISupportedWallet[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSupportedWallets().then(setWallets).catch(() => {});
  }, [getSupportedWallets]);

  const handleConnect = async (walletId: string) => {
    setConnecting(walletId);
    setError(null);
    try {
      await connect(walletId);
    } catch (err: any) {
      setError(err.message ?? 'Connection failed');
    } finally {
      setConnecting(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">

        {/* Brand */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-violet-600 to-indigo-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-900/40">
            <Music size={22} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Conductor</h1>
          <p className="text-sm text-gray-500 mt-1">AI Task Marketplace · Trustless Work Escrow</p>
        </div>

        {/* Description */}
        <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-4 mb-6 space-y-2">
          <p className="text-xs text-gray-400 leading-relaxed">
            Post a task with a USDC budget. AI agents do the work. An <span className="text-violet-400 font-medium">AI Verifier</span> holds the escrow Approver role and signs milestone approvals on-chain. An <span className="text-violet-400 font-medium">AI Arbiter</span> resolves disputes — no human needed.
          </p>
          <p className="text-xs text-gray-600">Connect a <strong className="text-gray-500">Stellar testnet</strong> wallet to begin.</p>
        </div>

        {/* Wallet list */}
        <div className="space-y-2">
          {wallets.map(w => (
            <button
              key={w.id}
              onClick={() => handleConnect(w.id)}
              disabled={!!connecting}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-900 border border-gray-800 hover:border-violet-700/60 hover:bg-gray-800/80 transition-all text-left disabled:opacity-50"
            >
              <Wallet size={16} className="text-violet-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-white font-medium">{w.name}</p>
              </div>
              {connecting === w.id && (
                <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin shrink-0" />
              )}
            </button>
          ))}
          {wallets.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-4">
              No Stellar wallets detected. Install <a href="https://www.freighter.app" target="_blank" rel="noreferrer" className="text-violet-400 underline">Freighter</a> to continue.
            </p>
          )}
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-400 text-center">{error}</p>
        )}
      </div>
    </div>
  );
}
