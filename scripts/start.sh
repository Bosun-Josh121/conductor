#!/usr/bin/env bash
# Conductor — start all services
# Usage: ./scripts/start.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
cd "$ROOT"

# Load nvm so Node 20 is available in non-login shells
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20 --silent 2>/dev/null || nvm use node --silent 2>/dev/null || true

# Verify Node 20+
NODE_VER=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VER" ] || [ "$NODE_VER" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required (found: $(node --version 2>/dev/null || echo 'none'))"
  echo "  Fix:  nvm install 20 && nvm use 20"
  exit 1
fi
echo "Node: $(node --version)"

# Verify .env
if [ ! -f ".env" ]; then
  echo "ERROR: .env not found. Copy .env.example -> .env and fill in keys."
  exit 1
fi

# Load .env (skip comment lines)
while IFS= read -r line; do
  [[ "$line" =~ ^#.*$ ]] && continue
  [[ -z "$line" ]] && continue
  export "$line" 2>/dev/null || true
done < .env

# Check critical secrets
missing=()
for var in TRUSTLESS_WORK_API_KEY ANTHROPIC_API_KEY PLATFORM_SECRET_KEY VERIFIER_SECRET_KEY ARBITER_SECRET_KEY; do
  val="${!var}"
  if [ -z "$val" ] || [[ "$val" == S... ]] || [[ "$val" == sk-ant-... ]]; then
    missing+=("$var")
  fi
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "ERROR: Missing values in .env:"
  for v in "${missing[@]}"; do echo "  $v"; done
  echo ""
  echo "  Run: npm run setup-wallets   (generates wallet keys)"
  exit 1
fi

mkdir -p logs data

echo "============================================================"
echo "  Conductor - Starting Services"
echo "============================================================"
echo ""

# Stop anything on our ports
for port in 3000 4000 4001 4002 4003 4004 4005; do
  pid=$(lsof -ti:$port 2>/dev/null)
  [ -n "$pid" ] && kill "$pid" 2>/dev/null && echo "  Killed stale process on :$port"
done
sleep 1
> /tmp/conductor.pids

# Start a service and track its PID
start_svc() {
  local name="$1" entry="$2"
  local log="logs/${name}.log"
  : > "$log"
  npx tsx "$entry" >> "$log" 2>&1 &
  local pid=$!
  echo "$pid" >> /tmp/conductor.pids
  echo "  -> $name  (PID $pid)"
}

# Wait for a port to respond (sequential - tsx startup takes 8-15s)
wait_port() {
  local port="$1" label="$2" secs="${3:-30}"
  local i=0
  while [ $i -lt $secs ]; do
    sleep 1 && i=$((i+1))
    if curl -sf --max-time 1 "http://localhost:$port/health" > /dev/null 2>&1; then
      echo "    check $label: ready (${i}s)"
      return 0
    fi
  done
  echo "    check $label: no response after ${secs}s"
  return 1
}

# Registry first
echo "Starting registry..."
start_svc "registry" "packages/registry/src/server.ts"
wait_port 4000 "Registry" 25

echo ""
echo "Starting agents..."
start_svc "stellar-oracle" "packages/agents/stellar-oracle/src/server.ts"
start_svc "web-intel"      "packages/agents/web-intel/src/server.ts"
start_svc "web-intel-v2"   "packages/agents/web-intel-v2/src/server.ts"
start_svc "analysis"       "packages/agents/analysis/src/server.ts"
start_svc "reporter"       "packages/agents/reporter/src/server.ts"

echo "  Waiting for agents..."
wait_port 4001 "StellarOracle" 35
wait_port 4002 "WebIntel"      35
wait_port 4003 "WebIntelV2"    35
wait_port 4004 "AnalysisBot"   35
wait_port 4005 "ReporterBot"   35

echo ""
echo "Starting orchestrator..."
start_svc "orchestrator" "packages/orchestrator/src/server.ts"
wait_port 3000 "Orchestrator" 40

# Build dashboard if not present
if [ ! -f "packages/orchestrator/public/index.html" ]; then
  echo ""
  echo "Building dashboard (first run - may take 30s)..."
  npm run build:dashboard 2>&1 | grep -E "built in|error|warn" | head -5
fi

# Health summary
echo ""
echo "============================================================"
echo "  Health Summary"
echo "============================================================"
all_ok=true
for entry in "4000:Registry:registry.log" "4001:StellarOracle:stellar-oracle.log" "4002:WebIntel:web-intel.log" "4003:WebIntelV2:web-intel-v2.log" "4004:AnalysisBot:analysis.log" "4005:ReporterBot:reporter.log" "3000:Orchestrator:orchestrator.log"; do
  port="${entry%%:*}"; rest="${entry#*:}"; label="${rest%%:*}"; log="${rest##*:}"
  if curl -sf --max-time 2 "http://localhost:$port/health" > /dev/null 2>&1; then
    echo "  OK  $label (:$port)"
  else
    echo "  ERR $label (:$port) -- tail logs/$log"
    all_ok=false
  fi
done

AGENT_COUNT=$(curl -sf http://localhost:4000/agents 2>/dev/null | python3 -c "import sys,json;print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
echo ""
echo "  Agents registered: $AGENT_COUNT"
echo ""
if $all_ok; then
  echo "  All services running!"
else
  echo "  Some services failed -- check logs above"
fi
echo ""
echo "  Dashboard:  http://localhost:3000"
echo "  API:        http://localhost:3000/api"
echo "  WebSocket:  ws://localhost:3000/ws"
echo "  Stop:       ./scripts/stop.sh   OR   npm stop"
echo "============================================================"
