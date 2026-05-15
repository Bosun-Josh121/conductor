#!/usr/bin/env bash
# Conductor — stop all services

echo "Stopping Conductor services..."

# Kill by saved PIDs
if [ -f /tmp/conductor.pids ]; then
  while IFS= read -r pid; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && echo "  Stopped PID $pid"
    fi
  done < /tmp/conductor.pids
  rm -f /tmp/conductor.pids
fi

# Belt-and-suspenders: kill anything still on our ports
for port in 3000 4000 4001 4002 4003 4004 4005; do
  pid=$(lsof -ti:$port 2>/dev/null)
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null && echo "  Killed :$port (PID $pid)"
  fi
done

# Kill any orphaned tsx processes from this project
pkill -f "tsx packages/" 2>/dev/null || true

echo "Done."
