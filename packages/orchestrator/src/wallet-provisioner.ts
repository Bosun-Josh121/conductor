import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

const SPONSOR_URL =
  process.env.SPONSOR_SERVICE_URL ||
  'https://stellar-sponsored-agent-account.onrender.com';

export interface ProvisionedWallet {
  publicKey: string;
  secretKey: string;
  explorerUrl: string;
  txHash: string;
}

export async function provisionAgentWallet(): Promise<ProvisionedWallet> {
  const kp = Keypair.random();

  const createRes = await fetch(`${SPONSOR_URL}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_key: kp.publicKey() }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Sponsor service error ${createRes.status}: ${body}`);
  }

  const { xdr, network_passphrase } = await createRes.json();

  const tx = TransactionBuilder.fromXDR(xdr, network_passphrase);
  if (tx.operations.length !== 4) {
    throw new Error(
      `Unexpected operation count: ${tx.operations.length} (expected 4). Refusing to sign.`
    );
  }

  tx.sign(kp);

  const submitRes = await fetch(`${SPONSOR_URL}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ xdr: tx.toXDR() }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!submitRes.ok) {
    const body = await submitRes.text();
    throw new Error(`Submit error ${submitRes.status}: ${body}`);
  }

  const result = await submitRes.json();

  return {
    publicKey: kp.publicKey(),
    secretKey: kp.secret(),
    explorerUrl:
      result.explorer_url ||
      `https://stellar.expert/explorer/testnet/account/${kp.publicKey()}`,
    txHash: result.hash || result.tx_hash || '',
  };
}
