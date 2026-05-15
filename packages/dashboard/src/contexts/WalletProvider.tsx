import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import {
  isConnected as freighterIsConnected,
  getAddress,
  signTransaction as freighterSignTx,
  isAllowed,
  requestAccess,
} from '@stellar/freighter-api';

interface WalletContextValue {
  publicKey: string | null;
  isConnected: boolean;
  isLoading: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string, networkPassphrase: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);
const LS_PUBKEY = 'conductor_pubkey';

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem(LS_PUBKEY);
    if (saved) {
      freighterIsConnected()
        .then(r => { if (r.isConnected) setPublicKey(saved); else localStorage.removeItem(LS_PUBKEY); })
        .catch(() => localStorage.removeItem(LS_PUBKEY))
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const connect = async () => {
    const allowed = await isAllowed();
    if (!allowed.isAllowed) {
      // Opens Freighter popup to grant access
      const access = await requestAccess();
      if (access.error) throw new Error(`Freighter: ${access.error}`);
      // requestAccess v6 returns { address } (not publicKey)
      const addr = (access as any).address ?? (access as any).publicKey ?? '';
      if (!addr) throw new Error('Freighter returned no address');
      setPublicKey(addr);
      localStorage.setItem(LS_PUBKEY, addr);
      return;
    }
    // Already allowed
    const result = await getAddress();
    if (result.error) throw new Error(`Freighter: ${result.error}`);
    setPublicKey(result.address);
    localStorage.setItem(LS_PUBKEY, result.address);
  };

  const disconnect = () => {
    setPublicKey(null);
    localStorage.removeItem(LS_PUBKEY);
  };

  const signTx = async (xdr: string, networkPassphrase: string): Promise<string> => {
    if (!publicKey) throw new Error('Wallet not connected');
    const result = await freighterSignTx(xdr, { networkPassphrase, address: publicKey });
    if (result.error) throw new Error(`Freighter: ${result.error}`);
    // v6 uses signedTxXdr; v5 used signedTransaction
    return (result as any).signedTxXdr ?? (result as any).signedTransaction ?? '';
  };

  return (
    <WalletContext.Provider value={{ publicKey, isConnected: !!publicKey, isLoading, connect, disconnect, signTransaction: signTx }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be inside WalletProvider');
  return ctx;
}
