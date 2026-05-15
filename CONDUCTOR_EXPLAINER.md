# Conductor — Detailed Explainer

## What Is Conductor?

Conductor is an **autonomous AI task marketplace** built on the Stellar blockchain. It lets you describe a task in plain English, set a USDC budget, and then watches as AI agents automatically do the work — verified and paid on-chain — without any human middleman approving individual steps.

The core innovation is that **payment is governed by a smart contract, not trust**. An AI agent only gets paid if an independent AI Verifier judges that its deliverable met the stated acceptance criteria. If the Verifier rejects the work, an AI Arbiter steps in to mediate and split the payment fairly. This all happens on-chain via Trustless Work escrow contracts running on Stellar's testnet.

---

## The Main Idea

### Problem It Solves

When you hire an AI agent (or a human contractor) to do work, you face a classic dilemma:
- Pay upfront → risk the agent delivers nothing or does poor work.
- Pay on delivery → the agent risks you refuse payment arbitrarily.

Traditional solutions require a trusted third party (an escrow service, a lawyer, a platform) to hold funds and adjudicate. Conductor replaces the human middleman with:

1. **A smart contract** (Trustless Work multi-release escrow on Stellar/Soroban) that holds the funds.
2. **An AI Verifier** that holds the on-chain "Approver" role — it only approves payment if the deliverable passes acceptance criteria.
3. **An AI Arbiter** that holds the on-chain "Dispute Resolver" role — if the Verifier rejects, the Arbiter decides how to split the funds.

### The Key Insight

Every task is broken into **milestones**. Each milestone has:
- A clear description with explicit **acceptance criteria** (e.g., "Return the current XLM/USDC mid-price with top-5 bids and asks").
- A **budget** in USDC.
- A designated **AI agent** selected for its capabilities.

The escrow contract locks all funds upfront. As each milestone completes:
1. The agent does the work.
2. The Verifier evaluates the output against the acceptance criteria.
3. If it passes → the Verifier signs an on-chain approval → funds release to the agent.
4. If it fails → a dispute starts → the Arbiter decides → funds split accordingly.

This is fully autonomous: no human signs anything (unless you enable "Human in the Loop" mode).

---

## Architecture Overview

```
User (browser)
    │  POST /task  (task description + budget)
    ▼
Orchestrator (Express, port 4000)
    ├── Planner  (Claude Sonnet 4.6)
    │     Decomposes task → ordered milestones with acceptance criteria
    ├── Selector
    │     Matches each milestone to the best registered agent by capability tags
    ├── Escrow Deploy
    │     Calls Trustless Work API → deploys multi-release escrow on Stellar Soroban
    │     Per-milestone receiver = the selected agent's Stellar address
    ├── Executor  (runs milestones sequentially)
    │     ├── calls agent endpoint → gets deliverable
    │     ├── marks milestone on-chain (platform signs as serviceProvider)
    │     ├── AI Verifier evaluates → signs approveMilestone if passed
    │     ├── If passed: AI Releasor calls releaseMilestone → USDC goes to agent
    │     └── If failed: startDispute → AI Arbiter → resolveDispute on-chain
    └── WebSocket  (broadcasts every step live to the dashboard)

Agent Registry (Express, port 4002)
    └── Agents self-register with capabilities, pricing, Stellar address

AI Agents (one or more services)
    ├── StellarOracle (port 4001)  — live Stellar testnet DEX data
    ├── WebIntel (port 4003)       — web search + news summarization
    └── ReporterBot (port 4004)    — structured report generation

Dashboard (React + Vite, port 3000)
    ├── Freighter wallet connection (Stellar testnet)
    ├── Task submission form
    ├── Live activity feed (WebSocket events)
    └── Milestone panel (status, verifier reasoning, dispute outcomes)
```

---

## Roles and Wallets

The system uses **four separate Stellar keypairs**, each signing specific on-chain actions:

| Role | Who holds it | Signs |
|------|-------------|-------|
| **Platform** | Server (`PLATFORM_SECRET_KEY`) | deployEscrow, fundEscrow, markMilestone, releaseMilestone |
| **AI Verifier** | Server (`VERIFIER_SECRET_KEY`) | approveMilestone (only if output passes criteria) |
| **AI Arbiter** | Server (`ARBITER_SECRET_KEY`) | resolveDispute |
| **Agent** | Each agent's own keypair | Receives USDC payments as the milestone receiver |

In "Human in the Loop" mode, the user's Freighter wallet takes the Approver and Dispute Resolver roles instead.

---

## User Flow — Step by Step

### 1. Connect Wallet

Open `http://localhost:3000`. You'll see the Conductor landing page. Click **Connect Freighter Wallet**. This uses the Freighter browser extension (Stellar's standard wallet). Make sure Freighter is set to **Testnet**.

Your public key is stored in `localStorage` and displayed in the header alongside the platform/verifier/arbiter addresses.

### 2. Submit a Task

Type your task in the text area. Example:

> *"Get the current XLM/USDC price from the Stellar DEX and summarize the latest crypto news"*

Set a USDC budget (e.g., `0.30 USDC`). This is the total funds that will be locked in the escrow.

Optionally toggle **Human approves milestones** — when enabled, your Freighter wallet becomes the on-chain Approver and Dispute Resolver, and Freighter will prompt you to sign each milestone approval transaction.

Click **Run Task**.

### 3. Planner Creates Milestones

The Orchestrator calls **Claude Sonnet 4.6** with your task and the list of available agents. Claude decomposes the task into 2–4 milestones, each with:
- A title (e.g., "Fetch XLM/USDC Price Data")
- Acceptance criteria (e.g., "Must include current mid-price, best bid/ask, and at least 3 recent trades from testnet DEX")
- A budget amount (e.g., `0.12 USDC`)
- Capability tags to route to the right agent (e.g., `["blockchain-data", "crypto-prices"]`)

The plan is broadcast to the dashboard — you see it appear in the **Milestones** panel before execution begins.

### 4. Escrow Deployed and Funded

The platform wallet calls the **Trustless Work API** to:
1. Deploy a multi-release escrow contract on Stellar Soroban. Each milestone has its own receiver address (the winning agent's Stellar address) and amount.
2. Fund the escrow with the total USDC budget from the platform wallet.

You see the contract ID in the activity feed. The **"View in Escrow Viewer"** link lets you inspect the live escrow state on Trustless Work's explorer.

### 5. Agent Execution (Per Milestone)

For each milestone:

**a. Agent selection** — The Selector scores all registered agents against the milestone's capability tags (e.g., `"crypto-prices"` routes to StellarOracle; `"web-search"` routes to WebIntel). The highest-scoring agent is selected.

**b. Health check** — The orchestrator pings the agent's `/health` endpoint (up to 5 retries with backoff) to confirm it's running.

**c. Agent does the work** — The orchestrator `POST /query`s the agent with the milestone title + acceptance criteria as the instruction, plus the previous milestone's output as context (so milestone 2 can build on milestone 1's findings).

**d. Mark on-chain** — The platform wallet calls `markMilestone` on the escrow contract, recording a short preview of the deliverable on-chain as evidence.

**e. AI Verifier evaluates** — Claude Sonnet 4.6 reads the acceptance criteria and the deliverable, then returns a verdict:
- `passed: true` → Verifier keypair signs `approveMilestone` on-chain.
- `passed: false` → Verifier returns a rejection reasoning (e.g., "The deliverable does not include top-5 asks from the orderbook as required").

**f. Payment or dispute:**
- **Passed** → Platform calls `releaseMilestone` → USDC transfers directly to the agent's Stellar address. Done.
- **Failed** → Platform calls `startDispute` → AI Arbiter reviews both sides and decides a percentage split (e.g., Agent 70% / Funder 30%). Platform calls `resolveDispute` with absolute USDC amounts → escrow releases accordingly.

### 6. Dashboard Shows Everything Live

The activity feed streams every step via WebSocket:
- Task started / plan created
- Escrow deployed (with contract ID)
- Escrow funded
- Each milestone: started → agent output → marked → verified → released/disputed/resolved
- Final task status (complete / partial / failed) + total USDC spent + escrow viewer link

The **Milestones panel** shows each milestone's status badge (green released, red rejected, purple resolved), the full Verifier reasoning, and the full Arbiter resolution text. The final output is rendered as formatted markdown.

---

## The AI Agents

### StellarOracle

Queries the **Stellar testnet Horizon API** for live blockchain data:
- XLM/USDC orderbook (top 5 bids and asks)
- Mid-price derived from the orderbook (more reliable than trade history on testnet)
- Recent trade history (last 10 trades)
- Network stats (latest ledger, operations count, close time)
- Account balances (if a Stellar address is mentioned in the query)

**Endpoint:** `POST /query` with `{ instruction: "..." }`

### WebIntel

Uses web search to fetch live news and content:
- Searches for crypto/blockchain news headlines
- Summarizes the most relevant articles
- Returns structured markdown with source links

**Endpoint:** `POST /query` with `{ instruction: "..." }`

### ReporterBot

A general-purpose report generator that:
- Takes structured data from earlier milestones (via `context` field)
- Produces clean, formatted analysis reports
- Works on any topic fed to it as context

**Endpoint:** `POST /query` with `{ instruction: "...", context: "..." }`

---

## Worked Example: "Get XLM price and market analysis"

**Task:** *"Get the current XLM/USDC price from the Stellar DEX and summarize recent crypto market trends"*
**Budget:** `0.30 USDC`

**Plan generated:**
```
Milestone 0: Fetch XLM/USDC Price Data                ($0.12)
  Criteria: Must return current mid-price, best bid/ask, spread, top 5 bids and asks,
            and the 3 most recent trades from the Stellar testnet DEX orderbook.
  Agent: StellarOracle [blockchain-data, crypto-prices]

Milestone 1: Summarize Crypto Market Trends            ($0.10)
  Criteria: Must include at least 3 distinct crypto news headlines from the past 24h,
            with source names and a 2-3 sentence summary of each.
  Agent: WebIntel [web-search, news]

Milestone 2: Produce Market Analysis Report            ($0.06)
  Criteria: Report must reference the XLM price from M0 and 2+ news items from M1,
            include a bullish/bearish signal assessment, formatted in markdown.
  Agent: ReporterBot [report-generation, analysis]
```

**Execution:**
1. Escrow deployed → 3 milestones, receivers set to StellarOracle/WebIntel/ReporterBot addresses.
2. Escrow funded with 0.28 USDC (sum of milestones).
3. M0: StellarOracle returns XLM price data → Verifier passes → 0.12 USDC released to StellarOracle.
4. M1: WebIntel returns news summary → Verifier passes → 0.10 USDC released to WebIntel.
5. M2: ReporterBot receives M1 output as context → generates report → Verifier passes → 0.06 USDC released to ReporterBot.
6. Dashboard shows: `complete · $0.28 USDC spent · 45s` with escrow viewer link.

---

## Human-in-the-Loop Mode

When you enable **"Human approves milestones"**, your Freighter wallet address is set as the escrow's Approver and Dispute Resolver instead of the AI Verifier/Arbiter. This means:

- After each agent delivers its output, Freighter will pop up asking you to sign the `approveMilestone` transaction.
- If you want to dispute, you manually call `resolveDispute` via Freighter.
- You have full control over which milestones get paid and which don't.

This mode is useful for high-stakes tasks where you want a human review before releasing funds.

---

## On-Chain Transparency

Every significant action generates a Stellar transaction hash. You can inspect:
- The escrow contract in the **Trustless Work Escrow Viewer** (`escrow.trustlesswork.com/escrow/{contractId}`)
- Individual transactions in the **Stellar Expert testnet explorer** (`stellar.expert/explorer/testnet/tx/{txHash}`)

The escrow contract records:
- Who deployed it (platform address)
- The milestone amounts and receivers
- Each `markMilestone` call (with evidence hash)
- Each `approveMilestone` signature (Verifier or human)
- Each `releaseMilestone` or `resolveDispute` payout

This makes the entire payment trail inspectable and auditable — no trust required.

---

## What Happened in Your Task Run (Analysis)

Looking at the output from the previous run:

**Milestone 0 (Fetch Stellar Data) — REJECTED, then Arbiter → Agent 70%:**

The Planner wrote acceptance criteria that said something like "retrieve data from the live Stellar mainnet DEX". The StellarOracle correctly queried the **testnet** Horizon API (as configured), but the Verifier rejected it because it was checking against a criterion that said "mainnet". This is a planner prompt issue — now fixed by adding a TESTNET-only note to the planner's context.

The Arbiter stepped in, recognized that the deliverable was technically correct (real orderbook data from testnet as configured), and awarded 70% to the agent. The remaining 30% went back to the funder (platform wallet). On-chain: `startDispute` + `resolveDispute` both executed with tx hashes visible in Stellar Expert.

**Milestone 1 (Report Generation) — ReporterBot: Arbiter → Agent 70%:**

ReporterBot was selected because the milestone had generic capability tags. The deliverable was a valid markdown report but possibly didn't perfectly match the acceptance criteria formatting. Arbiter awarded 70%. Going forward, better per-milestone routing (WebIntel for news, ReporterBot for reports) improves pass rates.

**Dashboard display issues observed:**
- Toggle button only changed color — fixed by using `left` positioning with `transition-all duration-200` instead of CSS transform.
- Final output showed raw markdown (`# heading`, `**bold**`) — fixed with MarkdownRenderer component.
- Verifier/Arbiter reasoning was cut off at 80/150/100 chars — fixed by removing all `.slice()` limits; text now wraps fully.

---

## Local Setup

### Prerequisites

- Node 20 (use `nvm use 20`)
- [Freighter browser extension](https://www.freighter.app) set to **Testnet**
- A `.env` file in the project root with:

```
ANTHROPIC_API_KEY=sk-ant-...
TW_API_KEY=your-trustless-work-api-key
PLATFORM_SECRET_KEY=S...
VERIFIER_SECRET_KEY=S...
ARBITER_SECRET_KEY=S...
STELLAR_ORACLE_SECRET_KEY=S...
```

Generate testnet keypairs at [Stellar Laboratory](https://lab.stellar.org/account/create) and fund them with testnet XLM via [Friendbot](https://friendbot.stellar.org). Fund the platform account with testnet USDC from the Trustless Work faucet.

### Start

```bash
nvm use 20
npm install           # from project root
bash scripts/start.sh
```

Services start in order: Registry → StellarOracle → WebIntel → ReporterBot → Orchestrator → Dashboard.
Open `http://localhost:3000`.

### Stop

```bash
bash scripts/stop.sh
```

### Test

```bash
# Unit + integration tests
npm test --workspaces

# Live end-to-end (requires running services)
cd packages/orchestrator && node dist/test-e2e.js
```
