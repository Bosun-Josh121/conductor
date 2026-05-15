import { X, ExternalLink } from 'lucide-react';

interface Props {
  name: string;
  pubkey: string;
  onClose: () => void;
}

export function BotDetailsModal({ name, pubkey, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">{name}</h2>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400">
            <X size={14} />
          </button>
        </div>
        <div className="bg-gray-950/60 rounded-lg p-3 space-y-1">
          <p className="text-xs text-gray-600">Stellar Address</p>
          <p className="text-xs text-gray-300 font-mono break-all">{pubkey}</p>
        </div>
        <a
          href={`https://stellar.expert/explorer/testnet/account/${pubkey}`}
          target="_blank" rel="noreferrer"
          className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300"
        >
          View on Explorer <ExternalLink size={9} />
        </a>
      </div>
    </div>
  );
}
