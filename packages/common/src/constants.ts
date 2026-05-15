// Network
export const TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';
export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

// USDC issuer on testnet (same as CleverCon / Trustless Work testnet)
export const USDC_ISSUER_TESTNET = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const USDC_ASSET_CODE = 'USDC';
export const USDC_DECIMALS = 7;
export const STROOPS_PER_USDC = 10_000_000;

// Stellar Explorer (testnet)
export const EXPLORER_BASE = 'https://stellar.expert/explorer/testnet';
export const txExplorerUrl = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;
export const accountExplorerUrl = (addr: string) => `${EXPLORER_BASE}/account/${addr}`;

// Trustless Work
export const TW_API_URL = process.env.TRUSTLESS_WORK_API_URL || 'https://dev.api.trustlesswork.com';
export const escrowViewerUrl = (contractId: string) =>
  `https://viewer.trustlesswork.com/${contractId}`;
