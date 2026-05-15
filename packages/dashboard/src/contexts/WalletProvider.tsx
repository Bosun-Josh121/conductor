/**
 * WalletProvider — Freighter integration via @stellar/freighter-api v6.
 *
 * v6 API changes from v5:
 *   getPublicKey() → getAddress() → { address: string }
 *   signTransaction() → { signedTxXdr: string }  (was signedTransaction)
 */
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
  setAllowed,
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
      // Re-verify Freighter still has us connected
      freighterIsConnected()
        .then(r => {
          if (r.isConnected) setPublicKey(saved);
          else localStorage.removeItem(LS_PUBKEY);
        })
        .catch(() => localStorage.removeItem(LS_PUBKEY))
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const connect = async () => {
    // Ask user to grant access (opens Freighter popup)
    const allowed = await isAllowed();
    if (!allowed.isAllowed) {
      const access = await requestAccess();
      if (access.error) throw new Error(`Freighter: ${access.error}`);
      const addr = access.publicKey;
      setPublicKey(addr);
      localStorage.setItem(LS_PUBKEY, addr);
      return;
    }
    // Already allowed — get address directly
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
    // v6: signTransaction returns { signedTxXdr, signerAddress, error? }
    const result = await freighterSignTx(xdr, { networkPassphrase, address: publicKey });
    if (result.error) throw new Error(`Freighter sign error: ${result.error}`);
    return (result as any).signedTxXdr ?? (result as any).signedTransaction ?? '';
  };

  return (
    <WalletContext.Provider value={{
      publicKey,
      isConnected: !!publicKey,
      isLoading,
      connect,
      disconnect,
      signTransaction: signTx,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider');
  return ctx;
}
