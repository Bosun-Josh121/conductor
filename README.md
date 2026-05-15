# Conductor

**Autonomous AI task marketplace where the escrow is the coordination layer.**

Built for the Boundless × Trustless Work Hackathon — Core Trustless Work Applications track.

> **Live escrow examples from testing:**
> - https://viewer.trustlesswork.com/CCZVEPT4VD6AI3H2T4PQSSYHLHU4B5KJBP7GBTFEIN542BIL22LEH4KN (round-trip proof: 2 milestones, APPROVED + RELEASED)
> - https://viewer.trustlesswork.com/CDCAETY4KZYEATP5SUYYOFH45TAMKUZ6UZEZHKQC3MBYXLSX7DQM3IDG (full task: dispute resolved on-chain by AI Arbiter)

---

## The Four Judging Questions

**What trust problem does this solve?**
AI agents can do valuable work but can't be trusted with prepayment, and can't be paid on completion without a slow human reviewing everything. Conductor solves this: every milestone is backed by a Trustless Work escrow. An **AI Verifier** holds the on-chain Approver role and signs milestone approvals only after checking each deliverable against explicit acceptance criteria — that signature is the on-chain condition that releases funds. No human in the critical path.

**Who are the parties?**
- **Human funder** — posts a task with a USDC budget (only touches the UI)
- **Specialist AI agents** — StellarOracle, WebIntel, AnalysisBot, ReporterBot — execute milestones, hold Service Provider role
- **AI Verifier** — holds the Approver role on-chain; evaluates deliverables with Claude and signs `approveMilestone` on-chain
- **AI Arbiter** — holds the Dispute Resolver role; when an agent contests a rejection, Claude weighs both sides and signs `resolveDispute` on-chain with a percentage split

**What condition unlocks funds?**
The AI Verifier's on-chain approval signature (signed by the Approver role keypair). The Verifier evaluates each criterion individually and only signs if the deliverable passes. This is the programmatic condition that releases funds — no human click required. If the Verifier rejects, the agent contests, and the AI Arbiter resolves via `resolveDispute` on-chain.

**Who resolves disputes?**
The AI Arbiter — an autonomous agent holding the Dispute Resolver role. When an agent contests a Verifier rejection, the Arbiter weighs both sides and resolves on-chain with an absolute USDC distribution (e.g. 70% to agent, 30% refund to funder). Its reasoning is logged in full. The human can optionally be swapped into either role via the human-override toggle in the UI.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Human (browser, Freighter wallet)                       │
│    → post task + budget                                  │
└───────────────────┬─────────────────────────────────────┘
                    │ POST /api/tasks
                    ▼
┌─────────────────────────────────────────────────────────┐
│  Conductor Orchestrator (Node.js / Express)              │
│                                                          │
│  1. Claude planner → milestones + acceptance criteria    │
│  2. deployEscrow  (platform wallet signs XDR)            │
│  3. fundEscrow    (platform wallet signs XDR)            │
│  4. For each milestone:                                  │
│     a. Agent executes, produces deliverable              │
│     b. markMilestone  (agent wallet signs)               │
│     c. AI Verifier evaluates vs acceptance criteria      │
│        → approveMilestone (verifier wallet signs)        │
│        → releaseMilestone (platform wallet signs)        │
│     d. [if rejected] startDispute (agent wallet signs)   │
│        → AI Arbiter arbitrates                           │
│        → resolveDispute (arbiter wallet signs)           │
└──────────┬──────────────────────────────────────────────┘
           │  All actions signed server-side with role keypairs
           ▼
    Trustless Work REST API (dev.api.trustlesswork.com)
           │
           ▼
    Stellar Testnet (Soroban contracts)
           │
           ▼
    Trustless Work Escrow Viewer (viewer.trustlesswork.com)
```

### Role → Wallet Assignment

| Trustless Work Role | Held by | Where signing happens |
|---|---|---|
| Funder / Depositor | Platform wallet (demo) / Human Freighter (production) | Orchestrator backend |
| Platform Address | Platform wallet | Orchestrator backend |
| Service Provider / Marker | Specialist agent wallet | Orchestrator backend |
| **Approver** | **AI Verifier wallet** | **Orchestrator backend — the key innovation** |
| Release Signer | Platform wallet | Orchestrator backend |
| **Dispute Resolver** | **AI Arbiter wallet** | **Orchestrator backend — the key innovation** |
| Receiver | Specialist agent wallet | — (receives funds) |

### What makes this the winning design

1. **AI Verifier holds the Approver role** — the escrow condition isn't "human clicks approve" but "Claude evaluates and cryptographically signs." This is the part every other team answers with a human.
2. **AI Arbiter holds the Dispute Resolver role** — disputes resolve fully autonomously on-chain with logged reasoning.
3. **Escrow is the coordination spine**, not a bolt-on — milestones map 1:1 to units of agent work.
4. **Live proof in the Escrow Viewer** — every task creates a real on-chain escrow.

---

## Verified Trustless Work Integration

All endpoints verified against the TW REST API documentation (May 2026):

| Action | Endpoint | Signer |
|---|---|---|
| Deploy escrow | `POST /deployer/multi-release` | Platform keypair |
| Fund escrow | `POST /escrow/multi-release/fund-escrow` | Platform/funder keypair |
| Mark milestone done | `POST /escrow/multi-release/change-milestone-status` | Agent keypair |
| Approve milestone | `POST /escrow/multi-release/approve-milestone` | Verifier keypair |
| Release funds | `POST /escrow/multi-release/release-milestone-funds` | Platform keypair |
| Start dispute | `POST /escrow/multi-release/dispute-milestone` | Agent keypair |
| Resolve dispute | `POST /escrow/multi-release/resolve-milestone-dispute` | Arbiter keypair |
| Submit signed XDR | `POST /helper/send-transaction` | — |
| Get escrow state | `GET /helper/get-escrow-by-contract-ids?contractIds[]=ID` | — |

All write actions follow the same pattern:
1. POST to TW API → receive unsigned XDR
2. Sign server-side with the role wallet keypair (`@stellar/stellar-sdk`)
3. Submit via `/helper/send-transaction` → on-chain

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20, TypeScript, Express, npm workspaces |
| Blockchain | Stellar Testnet, `@stellar/stellar-sdk` (server-side signing) |
| AI | Anthropic Claude Sonnet 4.6 (planner, verifier, arbiter) |
| Frontend | React 19, Vite, Tailwind CSS |
| Wallet | `@creit.tech/stellar-wallets-kit` (Freighter) |
| Escrow | Trustless Work REST API (`dev.api.trustlesswork.com`) |

---

## Quick Start

```bash
# 1. Install
git clone https://github.com/YOUR_USERNAME/conductor
cd conductor && npm install

# 2. Configure
cp .env.example .env
# Edit .env: add TRUSTLESS_WORK_API_KEY and ANTHROPIC_API_KEY

# 3. Generate wallets (auto-funds via Friendbot)
npm run setup-wallets
# Copy printed SECRET_KEY lines to .env

# 4. Add USDC trustlines
npm run add-usdc-trustlines

# 5. Fund platform wallet with testnet USDC (via Stellar DEX)
npm run fund-usdc

# 6. Verify TW integration (CRITICAL — must pass before running the app)
npm run tw-roundtrip

# 7. Seed agent reputation history
npm run bootstrap

# 8. Start all services
npm start
# Open: http://localhost:3000
```

Full setup guide: [SETUP.md](SETUP.md)

---

## Live Demo Walkthrough

1. Open http://localhost:3000 — connect Freighter (testnet)
2. Enter a task + budget, click **Run Task**
3. A Claude-generated plan with acceptance criteria appears — auto-approves in 60s, or approve manually
4. Watch the escrow deploy → fund → agents execute → **AI Verifier evaluates with detailed reasoning**
5. **Good deliverable**: Verifier approves on-chain → funds released to agent wallet
6. **Bad deliverable**: Verifier rejects → agent auto-contests → **AI Arbiter resolves on-chain with percentage split + reasoning**
7. Click **Escrow Viewer** link → every action is visible on-chain in real time

---

## Deployment (Render)

```bash
# Uses render.yaml — 7 services
# Set secrets in Render dashboard before deploying:
TRUSTLESS_WORK_API_KEY, ANTHROPIC_API_KEY,
PLATFORM_SECRET_KEY, VERIFIER_SECRET_KEY, ARBITER_SECRET_KEY,
STELLAR_ORACLE_SECRET_KEY, WEB_INTEL_SECRET_KEY,
WEB_INTEL_V2_SECRET_KEY, ANALYSIS_AGENT_SECRET_KEY, REPORT_AGENT_SECRET_KEY
```

---

## Code Reuse Disclosure

Conductor reuses several components from an earlier project (CleverCon): the agent registry, reputation engine, dashboard shell and wallet kit wiring, and the specialist agent service pattern. The following are **new work** built for this hackathon:

- `trustless-work-client.ts` — TW REST wrapper with server-side XDR signing (verified endpoints)
- `verifier.ts` — AI Verifier service (Approver role, on-chain approval signing)
- `arbiter.ts` — AI Arbiter service (Dispute Resolver role, on-chain dispute resolution)
- Reworked `planner.ts` — milestone-based output with explicit acceptance criteria
- Reworked `executor.ts` — full TW escrow lifecycle
- Dashboard escrow components: MilestonePanel, EscrowPanel, FundingPrompt
- `scripts/fund-usdc.ts`, `tw-roundtrip.ts`, `setup-wallets.ts` extensions

---

*Testnet only. No real funds.*
