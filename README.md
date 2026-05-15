# Conductor

**Autonomous AI task marketplace where the escrow is the coordination layer.**

Built for the Boundless × Trustless Work Hackathon — Core Trustless Work Applications track.

---

## The Four Judging Questions

**What trust problem does this solve?**
AI agents can do valuable work but can't be trusted with prepayment, and can't be paid on completion without a slow human checking everything. Conductor solves this: every milestone is backed by a Trustless Work escrow. An AI Verifier holds the on-chain Approver role and signs milestone approvals only after checking deliverables against explicit acceptance criteria. No human bottleneck; no trust required.

**Who are the parties?**
- **Human funder** — posts a task with a USDC budget; signs the deploy and fund transactions (only two actions required)
- **Specialist AI agents** — execute the work, submit deliverables, hold the Service Provider role
- **AI Verifier** — holds the Approver role; evaluates deliverables using Claude and signs on-chain approvals
- **AI Arbiter** — holds the Dispute Resolver role; resolves contested rejections on-chain with logged reasoning

**What condition unlocks funds?**
The AI Verifier's on-chain approval signature (signed by the Approver role wallet). The Verifier evaluates each milestone against its explicit acceptance criteria and only signs if the deliverable passes. This is the condition that releases funds — no human click required.

**Who resolves disputes?**
The AI Arbiter — an autonomous agent holding the Dispute Resolver role. When an agent contests a Verifier rejection, the Arbiter weighs both sides and calls `resolveDispute` on-chain with a percentage split (0–100% to receiver). Its reasoning is logged in the activity stream. The human can optionally be swapped into either role via the human-override toggle.

---

## Architecture

```
Human (Freighter)
   ↓ sign deploy + fund (only 2 human actions)
Conductor Orchestrator
   ↓ createPlan (Claude)
   ↓ deployEscrow (platform wallet signs)
   ↓ [wait for human fund]
   ↓ for each milestone:
      Specialist Agent → does work → markMilestone (agent wallet signs)
      AI Verifier → evaluates deliverable → approveMilestone (verifier wallet signs)
      Platform → releaseMilestone (platform wallet signs) → funds hit agent wallet
      [if rejected] → Agent contestsDisputeStart → AI Arbiter → resolveDispute
```

### Role → Wallet Assignment

| Trustless Work Role | Held by | Signs in |
|---|---|---|
| Funder / Depositor | Human's Freighter wallet | Browser |
| Platform Address | Platform wallet | Orchestrator backend |
| Service Provider / Marker | Specialist agent wallet | Orchestrator backend |
| Approver | **AI Verifier wallet** | Orchestrator backend |
| Release Signer | Platform wallet | Orchestrator backend |
| Dispute Resolver | **AI Arbiter wallet** | Orchestrator backend |
| Receiver | Specialist agent wallet | — (receives funds) |

The human signs **only 2 transactions** (deploy + fund). Everything else is server-side signed.

### What's new vs CleverCon (the seed project)

Conductor reuses CleverCon's registry, reputation engine, dashboard shell, and wallet kit wiring. The following are new for this hackathon:

- **`trustless-work-client.ts`** — server-side REST wrapper + signing for all Trustless Work lifecycle actions
- **`verifier.ts`** — AI Verifier: Claude evaluates deliverables, signs on-chain approvals
- **`arbiter.ts`** — AI Arbiter: Claude arbitrates disputes, signs on-chain resolutions
- **Reworked `planner.ts`** — produces milestone-based escrow specs with explicit acceptance criteria
- **Reworked `executor.ts`** — full escrow lifecycle: deploy → fund → mark → verify → approve → release → dispute
- **Reworked `server.ts`** — funding gate, human-override toggle, escrow-viewer links
- **Reworked dashboard** — milestone panel, escrow panel, funding prompt, Escrow Viewer deep links
- **Simplified agents** — x402/MPP payment middleware removed; payment is the escrow release

---

## Tech Stack

- **Node.js 20 + TypeScript** — monorepo (npm workspaces)
- **Express + WebSocket** — orchestrator API and real-time event stream
- **React 19 + Vite + Tailwind** — dashboard
- **@stellar/stellar-sdk** — server-side XDR signing
- **@creit.tech/stellar-wallets-kit** — Freighter integration
- **Anthropic SDK (Claude Sonnet 4.6)** — planner, verifier, arbiter
- **Trustless Work REST API** — escrow lifecycle (dev.api.trustlesswork.com)
- **Stellar Testnet** — only

---

## Quick Start

```bash
# 1. Install
npm install

# 2. Setup wallets (generates and funds all role wallets)
npm run setup-wallets

# 3. Add USDC trustlines
npm run add-usdc-trustlines

# 4. Copy printed env vars into .env, then:
npm run distribute-usdc

# 5. Verify round-trip (Phase 3 checkpoint)
npm run tw-roundtrip

# 6. Start all services
npm run dev

# 7. Open http://localhost:5173
```

### Required env vars

```
TRUSTLESS_WORK_API_KEY=      # Request at docs.trustlesswork.com
ANTHROPIC_API_KEY=           # Your Anthropic API key
PLATFORM_SECRET_KEY=         # From setup-wallets
VERIFIER_SECRET_KEY=         # From setup-wallets
ARBITER_SECRET_KEY=          # From setup-wallets
# ... specialist agent keys from setup-wallets
```

---

## Demo Walkthrough

1. Connect Freighter (testnet) → post a task with a USDC budget
2. Review the AI-generated plan with per-milestone acceptance criteria → approve
3. **Sign the deploy transaction** in Freighter (escrow appears in the Viewer)
4. **Sign the fund transaction** in Freighter (funds locked in escrow)
5. Watch agents execute milestones in the live feed
6. Watch the AI Verifier's reasoning appear — milestone flips to Approved in the Viewer
7. Funds release to the agent wallet — zero human clicks after step 4
8. To demo disputes: submit deliberately weak output → Verifier rejects → Arbiter resolves on-chain

Every milestone and escrow shows a deep link to the [Trustless Work Escrow Viewer](https://viewer.trustlesswork.com).

---

## Deployment

Conductor ships a `render.yaml` for multi-service deployment on Render. Services: registry, orchestrator, stellar-oracle, web-intel, web-intel-v2, analysis, reporter.

---

## Code Reuse Disclosure

Conductor reuses several components from an earlier project (CleverCon): the agent registry, reputation engine, dashboard shell and wallet kit wiring, and the specialist agent service patterns. The Trustless Work escrow integration, AI-signed milestone verification, and AI-driven dispute resolution are new work built for this hackathon. Trustless Work primitives are the core, not a bolt-on.
