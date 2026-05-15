import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:3000/ws');
ws.on('open', () => console.log('[WS] Connected'));
ws.on('message', (data) => {
  try {
    const e = JSON.parse(data.toString());
    const ts = new Date().toISOString().slice(11,19);
    console.log(`[${ts}] ${e.event}: ${JSON.stringify(e.data ?? {}).slice(0, 180)}`);
    if (['task_result','task_complete','task_error'].includes(e.event)) { ws.close(); }
  } catch {}
});
ws.on('close', () => process.exit(0));
setTimeout(() => ws.close(), 120000);
