import WebSocket from 'ws';
import { setTimeout as sleep } from 'timers/promises';

const ws = new WebSocket('ws://localhost:3000/ws');

ws.on('open', () => console.log('[WS] Connected'));
ws.on('message', (data) => {
  try {
    const evt = JSON.parse(data.toString());
    const ts = new Date().toISOString().slice(11,19);
    const summary = JSON.stringify(evt.data ?? {}).slice(0, 200);
    console.log(`[${ts}] ${evt.event}: ${summary}`);
    if (['task_result', 'task_complete', 'task_error'].includes(evt.event)) {
      console.log('Task finished!');
      ws.close();
    }
  } catch {}
});
ws.on('error', (e) => console.error('[WS ERROR]', e.message));
ws.on('close', () => { process.exit(0); });
setTimeout(() => { ws.close(); }, 90000);
