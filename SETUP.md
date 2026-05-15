# Conductor — Local Setup & Testing Guide

## Prerequisites

| Tool | Required version | Check |
|---|---|---|
| Node.js | 20+ | `node --version` |
| npm | 10+ | `npm --version` |
| Git | any | `git --version` |
| Freighter wallet | latest | Browser extension |

Install Node 20 if needed:
```bash
nvm install 20 && nvm use 20
```

---

## 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/conductor.git
cd conductor
npm install
```

---

## 2. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

### Required immediately:
```
TRUSTLESS_WORK_API_KEY=    # Request at docs.trustlesswork.com/...request-api-key
ANTHROPIC_API_KEY=         # Your Anthropic key
```

### Wallet keys (generated in step 3):
```
PLATFORM_SECRET_KEY=
VERIFIER_SECRET_KEY=
ARBITER_SECRET_KEY=
STELLAR_ORACLE_SECRET_KEY=
WEB_INTEL_SECRET_KEY=
WEB_INTEL_V2_SECRET_KEY=
ANALYSIS_AGENT_SECRET_KEY=
REPORT_AGENT_SECRET_KEY=
```

---

## 3. Generate & Fund Wallets

```bash
# Generate all 8 wallets (platform, verifier, arbiter + 5 agents)
# Friendbot automatically funds each with testnet XLM
npm run setup-wallets
```

Copy the printed `SECRET_KEY=...` lines into your `.env`.

```bash
# Add USDC trustlines to all wallets
npm run add-usdc-trustlines

# Fund the platform wallet with testnet USDC via Stellar DEX (XLM→USDC swap)
npm run tsx scripts/fund-usdc.ts
```

> **Alternative USDC source:** Go to https://faucet.circle.com, select "Stellar", paste the Platform wallet address, click "Get Tokens" (repeat 3-5 times). The platform wallet needs at least 20 USDC to fund multiple demo escrows.

Verify wallets at: `https://stellar.expert/explorer/testnet/account/YOUR_PLATFORM_PUBKEY`

---

## 4. Verify TW Integration (Critical Checkpoint)

This runs the full escrow lifecycle without the browser:

```bash
npm run tw-roundtrip
```

Expected output:
```
[1/7] Deploying... ✓ Contract ID: C...
[2/7] Funding...   ✓ TX: ...
[3/7] Mark 0...    ✓ TX: ...
[4/7] Approve 0... ✓ TX: ...
[5/7] Release 0... ✓ TX: ...
[6/7] Mark 1...    ✓ TX: ...
[7/7] Approve 1 + Release 1... ✓
ROUND-TRIP COMPLETE ✓
Escrow Viewer: https://viewer.trustlesswork.com/C...
```

Open the printed Escrow Viewer URL — both milestones should show **APPROVED + RELEASED**.

**If this doesn't pass, nothing else will. Debug here first.**

---

## 5. Start the Application

```bash
./scripts/start.sh
```

Then open: **http://localhost:3000**

To stop:
```bash
./scripts/stop.sh
```

---

## 6. Seed Reputation Data (Optional but recommended for demos)

```bash
npm run bootstrap
```

This seeds the agent registry with historical reputation scores so the agent selection panel looks populated.

---

## 7. What to Test

### Test A — Basic task submission
1. Open http://localhost:3000
2. Connect Freighter (testnet mode)
3. Enter task: `"Fetch the current XLM price from Stellar DEX"`
4. Budget: `0.2`
5. Click **Run Task**
6. Watch the **Live Activity** feed — you'll see:
   - `feasibility_checked` → `plan_created` → `plan_approval_required` (auto-approves in 60s)
   - `escrow_deployed` + contract ID + Escrow Viewer link
   - `escrow_funded` (platform wallet auto-funds)
   - `milestone_started` → `agent_output` → `milestone_marked` (on-chain tx hash)
   - `verifying` → `verified` (AI Verifier reasoning appears)
   - `milestone_released` (funds sent to agent) OR dispute path
7. Click the **Escrow Viewer** link in the dashboard → confirm state on-chain

### Test B — Approve/reject a plan manually (human-in-the-loop)
1. Submit a task
2. When `plan_approval_required` appears, click **Review Plan** in the dashboard
3. Read the milestones + acceptance criteria
4. Click **Approve** or **Reject**
5. The pipeline continues or stops based on your choice

### Test C — Human-override (you become the Approver)
1. Toggle **"Human-in-the-loop"** switch in the task form
2. Submit a task
3. After the agent marks a milestone done, you'll be prompted to approve it via Freighter
4. Sign the approval transaction in Freighter
5. Funds release

### Test D — Verifier rejects bad work → Arbiter resolves
1. Submit a task where the agent is likely to produce incomplete output
   (e.g., `"Write a 500-word essay on blockchain with full citations and diagrams"`)
2. The AI Verifier will reject partial work
3. The system auto-contests via `dispute_started` (on-chain tx hash)
4. The AI Arbiter weighs the evidence and resolves with a percentage split
5. `dispute_resolved` appears with on-chain tx hash and the Arbiter's reasoning
6. Open the Escrow Viewer — the milestone shows **DISPUTED → RESOLVED**

### Test E — Round-trip script (no browser)
```bash
npm run tw-roundtrip
```
Verifies the full lifecycle works purely server-side. All 8 tx hashes printed.

### Test F — Bootstrap then check reputation
```bash
npm run bootstrap
```
Then open http://localhost:3000 → Agents tab — agents should show reputation scores > 50.

---

## 8. Verifying On-Chain Proof

Every task result includes:
- **Escrow contract ID** — unique Stellar contract address
- **Escrow Viewer URL** — `https://viewer.trustlesswork.com/{contractId}`
- **Tx hashes** — each lifecycle action has a Stellar transaction hash

Click the Escrow Viewer link in the dashboard. You'll see:
- Milestone statuses: pending → completed → approved → released/disputed
- Role wallet addresses (Verifier, Arbiter, Platform)
- USDC amounts per milestone

All activity links to `https://stellar.expert/explorer/testnet/tx/{hash}` for on-chain verification.

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `PLATFORM_SECRET_KEY not set` | Run `npm run setup-wallets` and copy keys to `.env` |
| `tw-roundtrip` fails with 400 | Check `.env` — `TRUSTLESS_WORK_API_KEY` must be set correctly |
| `tw-roundtrip` fails with "fundEscrow" | Platform wallet has no USDC — run `scripts/fund-usdc.ts` |
| Services won't start | Run `./scripts/stop.sh` first, then `./scripts/start.sh` |
| Agents not registering | Registry must start first — check `logs/registry.log` |
| Verifier always rejects | Normal — it's honest. Check acceptance criteria in the plan |
| No Escrow Viewer link | Escrow deploy failed — check `TRUSTLESS_WORK_API_KEY` |
| `tsx` not found | Run `npm install` from repo root |
| Node version error | `nvm use 20` |

**Check service logs:**
```bash
tail -f logs/orchestrator.log   # main activity
tail -f logs/registry.log       # agent registration
tail -f logs/analysis.log       # agent errors
```

---

## 10. Environment Variables Reference

| Variable | Description |
|---|---|
| `TRUSTLESS_WORK_API_KEY` | TW API key — required for all write operations |
| `TRUSTLESS_WORK_API_URL` | `https://dev.api.trustlesswork.com` (testnet) |
| `ANTHROPIC_API_KEY` | For planner, verifier, arbiter |
| `PLATFORM_SECRET_KEY` | Platform wallet — signs deploy, release; receives platform fee |
| `VERIFIER_SECRET_KEY` | AI Verifier wallet — holds Approver role |
| `ARBITER_SECRET_KEY` | AI Arbiter wallet — holds Dispute Resolver role |
| `ORCHESTRATOR_PORT` | Default `3000` |
| `REGISTRY_PORT` | Default `4000` |
| `PLAN_APPROVAL_TIMEOUT_MS` | Default `60000` — auto-approves plans after this |
| `DEFAULT_BUDGET` | Default task budget if not specified |

---

## 11. Architecture Quick Reference

```
Human (Freighter) → post task + budget
      ↓
Orchestrator (port 3000)
  ├── Claude planner → milestones with acceptance criteria
  ├── deploy escrow (POST /deployer/multi-release) [platform signs]
  ├── fund escrow (POST /escrow/multi-release/fund-escrow) [platform signs]
  └── for each milestone:
       ├── Agent does work → POST /escrow/multi-release/change-milestone-status [agent signs]
       ├── AI Verifier evaluates → POST /escrow/multi-release/approve-milestone [verifier signs]
       ├── Platform releases → POST /escrow/multi-release/release-milestone-funds [platform signs]
       └── [if rejected] dispute → POST /escrow/multi-release/dispute-milestone [agent signs]
                         arbiter → POST /escrow/multi-release/resolve-milestone-dispute [arbiter signs]

Registry (port 4000)  — agent discovery + reputation
Agents (4001–4005)    — StellarOracle, WebIntel, WebIntelV2, AnalysisBot, ReporterBot
Dashboard             — served from port 3000 / static build
```
