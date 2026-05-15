#!/usr/bin/env bash
# Conductor — start all services
# Usage: ./scripts/start.sh
#        ./scripts/start.sh --no-agents   (only registry + orchestrator)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

cd "$ROOT"

# Require Node 20+
NODE_VER=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VER" ] || [ "$NODE_VER" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required (found: $(node --version 2>/dev/null || echo none))"
  echo "  Run: nvm use 20   OR   nvm install 20"
  exit 1
fi

# Require .env
if [ ! -f ".env" ]; then
  echo "ERROR: .env not found. Copy .env.example → .env and fill in keys."
  exit 1
fi

# Require critical env vars
source_env() {
  # Export vars from .env without sourcing (handles comments)
  while IFS= read -r line; do
    [[ "$line" =~ ^#.*$ ]] && continue
    [[ -z "$line" ]] && continue
    export "$line" 2>/dev/null || true
  done < .env
}
source_env

if [ -z "$TRUSTLESS_WORK_API_KEY" ] || [[ "$TRUSTLESS_WORK_API_KEY" == "TW_KEY_HERE" ]]; then
  echo "ERROR: TRUSTLESS_WORK_API_KEY not set in .env"
  exit 1
fi
if [ -z "$ANTHROPIC_API_KEY" ] || [[ "$ANTHROPIC_API_KEY" == sk-ant-... ]]; then
  echo "ERROR: ANTHROPIC_API_KEY not set in .env"
  exit 1
fi
if [ -z "$PLATFORM_SECRET_KEY" ] || [[ "$PLATFORM_SECRET_KEY" == S... ]]; then
  echo "ERROR: PLATFORM_SECRET_KEY not set. Run: npm run setup-wallets"
  exit 1
fi

mkdir -p logs data

echo "============================================================"
echo "  Conductor — Starting Services"
echo "============================================================"

# Kill any lingering services on our ports
for port in 3000 4000 4001 4002 4003 4004 4005; do
  pid=$(lsof -ti:$port 2>/dev/null)
  if [ -n "$pid" ]; then
    kill $pid 2>/dev/null && echo "  Killed stale process on :$port"
  fi
done

start_service() {
  local name=$1
  local cmd=$2
  local log="logs/${name}.log"
  npx tsx $cmd >> "$log" 2>&1 &
  echo $! >> /tmp/conductor.pids
  echo "  ✓ $name started (log: $log)"
}

echo ""
echo "Starting services..."
> /tmp/conductor.pids

start_service "registry"    "packages/registry/src/server.ts"
sleep 4  # registry must be up before agents register

start_service "stellar-oracle" "packages/agents/stellar-oracle/src/server.ts"
start_service "web-intel"      "packages/agents/web-intel/src/server.ts"
start_service "web-intel-v2"   "packages/agents/web-intel-v2/src/server.ts"
start_service "analysis"       "packages/agents/analysis/src/server.ts"
start_service "reporter"       "packages/agents/reporter/src/server.ts"
sleep 6  # agents need time to register

start_service "orchestrator"   "packages/orchestrator/src/server.ts"
sleep 5

echo ""
echo "============================================================"
echo "  Health checks"
echo "============================================================"

all_ok=true
for entry in "4000:Registry" "4001:StellarOracle" "4002:WebIntel" "4003:WebIntelV2" "4004:AnalysisBot" "4005:ReporterBot" "3000:Orchestrator"; do
  port="${entry%%:*}"
  label="${entry##*:}"
  status=$(curl -sf --max-time 3 "http://localhost:$port/health" 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print('UP')" 2>/dev/null)
  if [ "$status" = "UP" ]; then
    echo "  ✓ $label (:$port)"
  else
    echo "  ✗ $label (:$port) — check logs/${label,,}.log"
    all_ok=false
  fi
done

echo ""
if $all_ok; then
  echo "  All services running!"
else
  echo "  Some services failed — check logs/ for details."
fi

AGENT_COUNT=$(curl -sf http://localhost:4000/agents 2>/dev/null | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
echo ""
echo "  Registry: $AGENT_COUNT agents registered"
echo "  Dashboard: http://localhost:3000  (open in browser)"
echo "  API:       http://localhost:3000/api"
echo "  WebSocket: ws://localhost:3000/ws"
echo ""
echo "  PIDs saved to: /tmp/conductor.pids"
echo "  Stop:  ./scripts/stop.sh"
echo "============================================================"
