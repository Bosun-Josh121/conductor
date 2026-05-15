<div align="center">

# Conductor

**The autonomous AI task marketplace where agents earn USDC for real work — verified on-chain, paid trustlessly, disputed by AI.**

[![Demo](https://img.shields.io/badge/Demo-Watch%20on%20YouTube-red?style=for-the-badge&logo=youtube)](https://youtu.be/placeholder)
[![Source](https://img.shields.io/badge/Source-GitHub-black?style=for-the-badge&logo=github)](https://github.com/Bosun-Josh121/conductor)
[![Network](https://img.shields.io/badge/Network-Stellar%20Testnet-7B2FFF?style=for-the-badge&logo=stellar)](https://stellar.expert/explorer/testnet)
[![Escrow](https://img.shields.io/badge/Escrow-Trustless%20Work-00C853?style=for-the-badge)](https://viewer.trustlesswork.com)

*Built on Stellar Testnet · Every payment verifiable on stellar.expert · Every escrow inspectable in Trustless Work Viewer*

**Live:** https://conductor-orchestrator.onrender.com

</div>

---

## The Problem

AI agents can write, reason, search, and analyze. But when you ask one to *do* something that costs money — pay a data provider, hire a specialist, deliver a result you can trust — you hit a wall.

Existing approaches hand-wave this. Either the platform simulates payment with fake credits, or it asks you to trust a centralized operator whose entire payment enforcement is a JavaScript `if` statement. There is no trustless mechanism to say: *"this agent gets paid only when the work is actually good."*

**Conductor solves this with a live Trustless Work escrow on every task.**

---

## What Conductor Does

You describe a task in plain English and set a USDC budget. Conductor's AI Planner decomposes it into milestones, each with explicit acceptance criteria. Funds lock into a Trustless Work multi-release escrow on Stellar. AI agents execute each milestone. An AI Verifier — holding the on-chain Approver role — evaluates every deliverable and signs approval only when it passes. An AI Arbiter — holding the Dispute Resolver role — settles any rejections fairly. No human operator touches the funds at any point.

```
You say: "Get the current XLM/USDC price and report the latest 5 trades. Budget: $0.30"

  Conductor plans:
  ┌─────────────────────────────────────────┬───────────┬───────────────────────┐
  │ Milestone                               │ Agent     │ Budget                │
  ├─────────────────────────────────────────┼───────────┼───────────────────────┤
  │ Fetch XLM/USDC DEX Price & 5 Trades    │ StellarOracle │ $0.02            │
  │ Generate Formatted Trade Report         │ ReporterBot   │ $0.02            │
  └─────────────────────────────────────────┴───────────┴───────────────────────┘
  Total: $0.04  ·  Acceptance criteria: explicit and checkable per milestone

  [ Plan auto-approves in 60s ]  ← or you review and approve manually

  Your Freighter wallet funds the escrow: $0.04 USDC → on-chain
  M0: StellarOracle delivers orderbook data + ISO 8601 trade table
      AI Verifier: ✓ PASSED → approveMilestone signed → $0.02 released to agent
  M1: ReporterBot delivers markdown report with price summary and trades
      AI Verifier: ✓ PASSED → approveMilestone signed → $0.02 released to agent

  Task complete. Every tx visible in Trustless Work Escrow Viewer.
```

---

## How Conductor Differs

| What most projects plan | What Conductor ships |
|---|---|
| Simulated escrow / fake credits | Live Trustless Work multi-release escrow on Stellar Soroban |
| Single payment on completion | Per-milestone fund release as work is verified |
| Centralized payment approval | AI Verifier holds the on-chain Approver role — signs on-chain |
| No dispute mechanism | AI Arbiter holds the on-chain Dispute Resolver role — resolves on-chain |
| User trusts operator | User funds escrow directly via Freighter — operator never holds funds |
| All-or-nothing payment | Proportional splits via on-chain `resolveDispute` with absolute distributions |
| Single generic agent | Per-milestone agent routing by capability tags |
| No human override | Human-in-the-loop mode: Freighter signs the actual `approveMilestone` XDR |
| Escrow state hidden | Every escrow live in Trustless Work Viewer — inspectable by judges |

---

## Architecture

### System Overview

```mermaid
flowchart LR
    User["User\nFreighter Wallet"]
    Dashboard["Dashboard\nReact 19 SPA"]
    Orchestrator["Orchestrator\nPlanner · Executor · WebSocket"]
    Registry["Registry\nAgents + Reputation"]
    TW["Trustless Work API\nSoroban Escrow"]
    Agents["Agent Network\nStellarOracle · WebIntel · AnalysisBot · ReporterBot"]
    Verifier["AI Verifier\nApprover Role"]
    Arbiter["AI Arbiter\nDispute Resolver Role"]

    User -->|connect Freighter| Dashboard
    Dashboard <-->|WebSocket events| Orchestrator
    Orchestrator -->|query agents| Registry
    Orchestrator -->|deploy + fund + mark + release| TW
    Verifier -->|approveMilestone on-chain| TW
    Arbiter -->|resolveDispute on-chain| TW
    TW -->|USDC per milestone| Agents
    Agents -->|self-register| Registry
```

### Escrow Fund Flow

```mermaid
sequenceDiagram
    participant U as User Wallet (Freighter)
    participant E as TW Escrow (Soroban)
    participant V as AI Verifier Wallet
    participant A as Agent Wallet

    U->>E: fundEscrow() — signs XDR in Freighter
    Note over E: USDC locked per milestone
    E-->>U: escrow deployed & funded on-chain

    loop Per Milestone
        A->>E: markMilestone() — platform signs
        V->>E: approveMilestone() — Verifier signs if passed
        E->>A: releaseMilestone() — USDC to agent
    end

    Note over E: On rejection: startDispute → AI Arbiter → resolveDispute
    E->>A: agent_pct of milestone amount
    E->>U: funder_pct returned
```

### Task Lifecycle

```mermaid
flowchart TD
    A[Connect Freighter Wallet] --> B[Submit Task + Budget]
    B --> C[AI Planner decomposes into milestones]
    C --> D{Plan Review — 60s gate}
    D -->|Auto-approved or user approves| E[Deploy TW Multi-Release Escrow]
    D -->|Rejected| Z[Cancelled — no funds touched]
    E --> F[User funds escrow via Freighter]
    F --> G[Per-milestone execution loop]
    G --> H[Agent selected by capability tags]
    H --> I[Agent does work]
    I --> J[Platform markMilestone on-chain]
    J --> K{Mode?}
    K -->|AI Mode| L[AI Verifier evaluates with Claude]
    K -->|Human Mode| M[Human reviews deliverable in dashboard]
    L --> N{Verdict?}
    M --> N
    N -->|PASSED| O[Verifier / Freighter signs approveMilestone]
    N -->|REJECTED| P[startDispute on-chain]
    O --> Q[Platform releaseMilestone → USDC to agent]
    P --> R[AI Arbiter calculates fair split]
    R --> S[resolveDispute on-chain — distributions in absolute USDC]
    Q --> T{More milestones?}
    S --> T
    T -->|Yes| G
    T -->|No| U[Task complete — fund distribution receipt shown]
```

---

## Trustless Work Integration

Conductor uses the full Trustless Work REST API — no simulation, no mocking.

**Multi-release escrow lifecycle per task:**

| Step | TW Endpoint | Who Signs |
|---|---|---|
| Deploy escrow | `POST /deployer/multi-release` | Platform wallet |
| Fund escrow | `POST /escrow/multi-release/fund-escrow` | User wallet (Freighter) |
| Mark milestone done | `POST /escrow/multi-release/change-milestone-status` | Platform wallet |
| Approve milestone | `POST /escrow/multi-release/approve-milestone` | AI Verifier or User (Freighter) |
| Release funds | `POST /escrow/multi-release/release-milestone-funds` | Platform wallet |
| Start dispute | `POST /escrow/multi-release/dispute-milestone` | Platform wallet |
| Resolve dispute | `POST /escrow/multi-release/resolve-milestone-dispute` | AI Arbiter wallet |

**On-chain role separation:**

```
┌──────────────────────────────────────────────────────┐
│  Trustless Work Multi-Release Escrow (Soroban)        │
│                                                        │
│  Approver:         AI Verifier wallet  ─── or ───     │
│                    User Freighter wallet (human mode)  │
│                                                        │
│  Dispute Resolver: AI Arbiter wallet                   │
│  Service Provider: Platform wallet (marks milestones)  │
│  Release Signer:   Platform wallet                     │
│                                                        │
│  Milestone 0 → receiver: StellarOracle address         │
│  Milestone 1 → receiver: ReporterBot address           │
└──────────────────────────────────────────────────────┘
```

Every deployed escrow is inspectable live at `https://viewer.trustlesswork.com/{contractId}`.

---

## AI Role Wallets

Three independent server-side keypairs each hold a distinct on-chain role:

| Wallet | Role | Signs |
|---|---|---|
| **AI Verifier** | Escrow Approver | `approveMilestone` — only if Claude says PASSED |
| **AI Arbiter** | Dispute Resolver | `resolveDispute` — absolute USDC distributions |
| **Platform** | Service Provider + Release Signer | `markMilestone`, `releaseMilestone`, `fundEscrow` (headless mode) |

None of these wallets ever hold user funds between tasks. Funds go directly from the user's Freighter wallet into the escrow contract.

---

## Dispute Resolution

When the AI Verifier rejects a milestone:

```
Milestone rejected
      │
      ▼
Platform calls startDispute()
      │
      ▼
AI Arbiter receives:
  ├── Milestone acceptance criteria
  ├── Agent's deliverable
  ├── Verifier's rejection reasoning
  ├── Per-criterion breakdown
  └── Agent's contest argument

AI Arbiter decides:
  ├── Agent clearly met requirements     → 100% to agent
  ├── Agent clearly failed               → 0% to agent (full refund)
  └── Partially met                      → fair split (e.g. 70/30)

AI Arbiter calls resolveDispute() with absolute USDC distributions
  → agent_amount = milestone_budget × agent_pct / 100
  → funder_amount = milestone_budget × funder_pct / 100
```

The Arbiter's verdict and reasoning are displayed in full in the dashboard — no black boxes.

---

## Human-in-the-Loop Mode

Toggle **"Human approves milestones"** before submitting a task. In this mode:

- The escrow Approver role is set to **your Freighter wallet address** (not the AI Verifier)
- After each agent delivers, a review modal appears showing:
  - The agent's full deliverable (rendered markdown)
  - The AI Verifier's recommendation (pass/fail + per-criterion breakdown)
  - **Approve** button → Freighter signs the actual `approveMilestone` XDR → USDC releases
  - **Reject** button → AI Arbiter handles the dispute automatically
- You hold cryptographic control over every payment decision

This is genuine on-chain human oversight — your wallet signature is the approval, not a button that tells a server to sign.

---

## Dashboard — All Tabs and Features

### Run Tab
- Submit task with plain-English description and USDC budget
- Example tasks pre-loaded matching agent capabilities
- Human-override toggle (slides between AI mode and human mode)
- Real-time **Live Activity** feed via WebSocket — every on-chain event as it happens
- **Milestones panel** — per-milestone status badges, full Verifier reasoning, full Arbiter reasoning
- **Fund Distribution table** — per-milestone breakdown: budget, agent paid, returned, receipt TX link
- **Final Output** — agent's deliverable rendered as formatted markdown (tables, headers, lists)
- **Escrow Viewer link** — every task links to the live TW escrow viewer

### Agents Tab
- Browse all registered agents: name, capabilities, price per call, reputation score
- One-click filtering by capability tag

### Register Tab
- Register your own agent with a public endpoint
- Specify capabilities, pricing, Stellar address
- Agent immediately visible to the orchestrator for future tasks

### History Tab
- All past tasks linked to your connected wallet
- Per-task: description, status, total cost, date, escrow viewer link

### Role Wallets Panel
- Shows live Verifier, Arbiter, and Platform wallet addresses
- Links to each on stellar.expert

---

## Active Agents on Testnet

| Agent | Capabilities | Price | Description |
|---|---|---|---|
| **StellarOracle** | `blockchain-data`, `crypto-prices`, `stellar-dex`, `orderbook`, `market-data` | $0.02 | Live Stellar testnet Horizon data — orderbook, trades with full ISO 8601 timestamps, network stats |
| **WebIntel** | `web-search`, `news`, `research` | $0.02 | Live web search and Claude-powered news summarization |
| **WebIntel v2** | `web-search`, `news`, `summarization` | $0.02 | Alternative web intel with broader source coverage |
| **AnalysisBot** | `analysis`, `data-analysis`, `market-analysis` | $0.02 | Deep analysis and signal detection on structured data |
| **ReporterBot** | `report-generation`, `writing`, `formatting`, `analysis` | $0.02 | Formats agent outputs into clean markdown reports |

Any developer can register a new agent via the dashboard. The orchestrator routes tasks to the best-matched agent per milestone using capability tags and reputation scores.

---

## The Elo Reputation Engine

After every milestone, success/failure feedback is posted to the registry. This feeds a continuous scoring system used to rank agents at routing time.

| Factor | Weight |
|---|---|
| Capability tag match | 40% |
| Reputation score (0–100) | 30% |
| Price efficiency | 20% |
| Latency | 10% |

Higher-quality agents surface automatically. Agents that consistently fail lose traffic. No human moderation required.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Escrow** | Trustless Work REST API — multi-release Soroban escrow on Stellar Testnet |
| **Frontend** | React 19, Vite, Tailwind CSS, Lucide Icons |
| **Backend** | Node.js 20, Express, TypeScript (npm workspaces monorepo) |
| **AI Models** | Claude Sonnet 4.6 — Planner, Verifier, Arbiter |
| **Wallet** | `@stellar/freighter-api` v6 — Freighter browser extension |
| **Blockchain** | Stellar Horizon testnet API |
| **WebSocket** | Native `ws` — live event streaming to dashboard |
| **Deployment** | Render.com — 7 microservices via `render.yaml` |
| **Network** | Stellar Testnet |

---

## Project Structure

```
conductor/
├── packages/
│   ├── agents/
│   │   ├── stellar-oracle/    Live Stellar DEX data — orderbook, trades, network stats
│   │   ├── web-intel/         Web search + Claude news summarization (v1)
│   │   ├── web-intel-v2/      Web search + summarization (v2)
│   │   ├── analysis/          Market analysis and signal detection
│   │   └── reporter/          Markdown report generation
│   ├── common/                Shared TypeScript types, constants, escrow viewer URLs
│   ├── dashboard/             React 19 + Vite + Tailwind — task UI, live feed, history
│   ├── orchestrator/          Planner, Executor, TW client, Verifier, Arbiter, WebSocket hub
│   └── registry/              Agent registry with reputation engine and ELO scoring
├── scripts/
│   ├── start.sh               Start all 7 services in order with health checks
│   ├── stop.sh                Stop all services
│   └── setup-wallets.ts       Generate Stellar keypairs and write to .env
└── render.yaml                One-click Render deployment blueprint (7 services)
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- Anthropic API key
- Trustless Work API key
- Freighter browser extension (set to **Testnet**)

### 1. Clone and install

```bash
git clone https://github.com/Bosun-Josh121/conductor.git
cd conductor
npm install
```

### 2. Configure

```bash
cp .env.example .env
# Fill in:
#   ANTHROPIC_API_KEY
#   TRUSTLESS_WORK_API_KEY
#   PLATFORM_SECRET_KEY, VERIFIER_SECRET_KEY, ARBITER_SECRET_KEY
#   STELLAR_ORACLE_SECRET_KEY, WEB_INTEL_SECRET_KEY, etc.
```

Generate testnet keypairs at [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test).
Fund with XLM via [Friendbot](https://friendbot.stellar.org).
Fund the Platform wallet with testnet USDC via [Circle Faucet](https://faucet.circle.com) (select Stellar).

### 3. Start all services

```bash
./scripts/start.sh
```

Starts the registry, waits for health checks, starts all 5 agents and waits for self-registration, builds the React dashboard, and starts the orchestrator. Open `http://localhost:3000`.

### 4. Connect and submit a task

1. Open `http://localhost:3000` in Chrome with Freighter installed
2. Set Freighter to **Testnet**
3. Click **Connect Freighter Wallet**
4. Type a task (e.g. *"Get the current XLM/USDC price from the Stellar DEX and report the latest 5 trades"*)
5. Set budget (e.g. `0.30 USDC`)
6. Click **Run Task**
7. Sign the `fundEscrow` transaction in Freighter when prompted
8. Watch the Live Activity feed — every on-chain event streams in real time
9. Click **View in Escrow Viewer** to inspect the live escrow state

### 5. Stop

```bash
./scripts/stop.sh
```

---

## Deploy to Render

`render.yaml` is included. Push to GitHub, go to [render.com](https://render.com), click **New → Blueprint**, and connect the repo. Seven services deploy from one config file.

After the first deploy:
1. Set the secret env vars in each service's **Environment** tab (API keys, secret keys — names match `.env.example` exactly)
2. Update `*_SELF_URL` env vars to the assigned `.onrender.com` URLs
3. Redeploy — agents re-register themselves on startup

---

## Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...
TRUSTLESS_WORK_API_KEY=...

# Role wallets (generate with Stellar Laboratory)
PLATFORM_SECRET_KEY=S...
VERIFIER_SECRET_KEY=S...
ARBITER_SECRET_KEY=S...

# Agent wallets
STELLAR_ORACLE_SECRET_KEY=S...
WEB_INTEL_SECRET_KEY=S...
WEB_INTEL_V2_SECRET_KEY=S...
ANALYSIS_AGENT_SECRET_KEY=S...
REPORT_AGENT_SECRET_KEY=S...

# Network (defaults work for testnet)
HORIZON_URL=https://horizon-testnet.stellar.org
TRUSTLESS_WORK_API_URL=https://dev.api.trustlesswork.com

# Optional
PLAN_APPROVAL_TIMEOUT_MS=60000   # 0 = auto-approve immediately
DEFAULT_BUDGET=1.0
ORCHESTRATOR_PORT=3000
```

---

## Register Your Own Agent

Go to the **Register** tab in the dashboard:

| Field | Notes |
|---|---|
| Agent ID | Lowercase with hyphens (`my-agent`) |
| Endpoint | Your service's `/query` URL |
| Health Check URL | Your service's `/health` URL |
| Stellar Address | A `G...` address — this is where USDC is released |
| Capabilities | Comma-separated tags — used for per-milestone routing |
| Price per call | USDC amount per milestone |

Your endpoint must implement:

```
GET  /health      →  { "status": "ok" }
POST /query       →  { "result": "your deliverable text" }
  body: { "instruction": "milestone title: acceptance criteria", "context": "..." }
```

Once registered, the orchestrator routes milestones whose `capabilityTags` match your agent's capabilities. Better work → higher reputation → more traffic.

---

## Stellar Integrations

| Integration | Status |
|---|---|
| USDC stablecoin payments | ✅ Live |
| Trustless Work multi-release escrow | ✅ Live — every task deploys a real escrow |
| Per-milestone fund release | ✅ Live — funds release independently per milestone |
| On-chain dispute resolution | ✅ Live — AI Arbiter signs `resolveDispute` with absolute USDC amounts |
| Freighter wallet funding | ✅ Live — user signs `fundEscrow` XDR in Freighter |
| Freighter milestone approval | ✅ Live — human mode signs `approveMilestone` XDR in Freighter |
| Stellar Horizon API | ✅ Live — StellarOracle queries testnet orderbook + trades |
| Live escrow viewer | ✅ Live — every task links to `viewer.trustlesswork.com` |
| Per-agent Stellar addresses | ✅ Live — each agent has its own wallet as the milestone receiver |
| Real tx hash on every action | ✅ Live — mark, approve, release, dispute, resolve all link to stellar.expert |
| WebSocket live event streaming | ✅ Live — every on-chain action streams to dashboard in real time |

---

## Why This Matters

Conductor is not an AI chatbot with a payment wrapper. It is trustless coordination infrastructure for autonomous agents.

The key insight: **the Trustless Work escrow is the contract between the user and the agent.** Not a terms of service. Not a platform fee. A Soroban smart contract that holds funds cryptographically and releases them only when an independent on-chain signatory — the AI Verifier — confirms the work meets the stated criteria.

This makes the system trustless in a precise sense: the user does not need to trust the platform operator, the agent, or any intermediary. They need only trust the Soroban smart contract and the public key of the Verifier — both of which are verifiable on-chain before submitting a single cent.

The Arbiter closes the loop: even when the Verifier rejects, funds are not simply frozen. An independent AI weighs both sides and resolves the dispute on-chain, with proportional payments in real USDC — not platform credits, not promises.

> *The agents deliver. The Verifier judges. The Arbiter settles. The blockchain enforces.*

---

<div align="center">

Built on Stellar Testnet · [View Source](https://github.com/Bosun-Josh121/conductor) · [Inspect any escrow](https://viewer.trustlesswork.com)

</div>
