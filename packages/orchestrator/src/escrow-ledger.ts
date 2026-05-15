import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(path.resolve(process.argv[1]));
const DATA_DIR  = path.join(__dirname, '..', '..', '..', 'data');
const LEDGER_PATH = path.join(DATA_DIR, 'escrow-ledger.json');

export type EscrowTxType =
  | 'deploy'
  | 'fund'
  | 'mark'
  | 'approve'
  | 'release'
  | 'dispute_start'
  | 'dispute_resolve';

export interface EscrowLedgerEntry {
  id: string;
  user_address: string;
  type: EscrowTxType;
  escrow_contract_id: string;
  milestone_index?: number;
  amount_usdc?: number;
  tx_hash?: string;
  task_id?: string;
  agent_name?: string;
  timestamp: string;
}

type Ledger = EscrowLedgerEntry[];

let cache: Ledger | null = null;

function load(): Ledger {
  if (cache) return cache;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(LEDGER_PATH)) fs.writeFileSync(LEDGER_PATH, '[]', 'utf8');
    cache = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')) as Ledger;
  } catch {
    cache = [];
  }
  return cache;
}

function save(ledger: Ledger): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const trimmed = ledger.slice(-2000);
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(trimmed, null, 2), 'utf8');
  cache = trimmed;
}

let _seq = 0;
function nextId(): string {
  return `elg_${Date.now()}_${++_seq}`;
}

export function appendEscrowTx(entry: Omit<EscrowLedgerEntry, 'id' | 'timestamp'>): EscrowLedgerEntry {
  const ledger = load();
  const record: EscrowLedgerEntry = {
    ...entry,
    id: nextId(),
    timestamp: new Date().toISOString(),
  };
  ledger.push(record);
  save(ledger);
  return record;
}

export function getEscrowLedger(userAddress: string, limit = 100): EscrowLedgerEntry[] {
  const ledger = load();
  return ledger
    .filter(e => e.user_address === userAddress)
    .slice(-limit)
    .reverse();
}
