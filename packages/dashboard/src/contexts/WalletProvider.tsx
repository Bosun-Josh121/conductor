/**
 * WalletProvider — direct Freighter integration via @stellar/freighter-api.
 * Replaces @creit.tech/stellar-wallets-kit to avoid its complex lit/ESM
 * dependency chain that prevents the vite build from completing.
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
  getPublicKey,
  signTransaction,
  isAllowed,
  setAllowed,
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
      freighterIsConnected().then(connected => {
        if (connected.isConnected) {
          setPublicKey(saved);
        } else {
          localStorage.removeItem(LS_PUBKEY);
        }
      }).catch(() => {
        localStorage.removeItem(LS_PUBKEY);
      }).finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const connect = async () => {
    const allowed = await isAllowed();
    if (!allowed.isAllowed) {
      await setAllowed();
    }
    const result = await getPublicKey();
    if (result.error) throw new Error(result.error);
    setPublicKey(result.publicKey);
    localStorage.setItem(LS_PUBKEY, result.publicKey);
  };

  const disconnect = () => {
    setPublicKey(null);
    localStorage.removeItem(LS_PUBKEY);
  };

  const signTx = async (xdr: string, networkPassphrase: string): Promise<string> => {
    if (!publicKey) throw new Error('Wallet not connected');
    const result = await signTransaction(xdr, { networkPassphrase, accountToSign: publicKey });
    if (result.error) throw new Error(result.error);
    return result.signedTransaction;
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
