/**
 * Bootstrap script — seeds registry with agent reputation history.
 * Runs several fast-path task simulations so the UI shows real data.
 */
import 'dotenv/config';

const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:4000';
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_SELF_URL || 'http://localhost:3000';

const FAKE_JOBS = [
  { agent_id: 'analysis-agent',  success: true,  quality_rating: 4, latency_ms: 1200 },
  { agent_id: 'reporter-agent',  success: true,  quality_rating: 5, latency_ms: 800  },
  { agent_id: 'web-intel',       success: true,  quality_rating: 4, latency_ms: 2100 },
  { agent_id: 'web-intel-v2',    success: true,  quality_rating: 4, latency_ms: 1800 },
  { agent_id: 'stellar-oracle',  success: true,  quality_rating: 5, latency_ms: 600  },
  { agent_id: 'analysis-agent',  success: true,  quality_rating: 3, latency_ms: 1500 },
  { agent_id: 'reporter-agent',  success: false, quality_rating: 2, latency_ms: 3000 },
  { agent_id: 'web-intel',       success: true,  quality_rating: 5, latency_ms: 1900 },
  { agent_id: 'analysis-agent',  success: true,  quality_rating: 4, latency_ms: 1100 },
  { agent_id: 'stellar-oracle',  success: true,  quality_rating: 5, latency_ms: 500  },
];

async function seedFeedback() {
  console.log(`Seeding ${FAKE_JOBS.length} reputation events into ${REGISTRY_URL}...`);

  for (const job of FAKE_JOBS) {
    const body = {
      ...job,
      job_id: `bootstrap-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date().toISOString(),
    };
    try {
      const res = await fetch(`${REGISTRY_URL}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        console.log(`  ✓ ${job.agent_id} feedback (success=${job.success}, q=${job.quality_rating})`);
      } else {
        const text = await res.text();
        console.warn(`  ⚠ ${job.agent_id}: ${res.status} ${text.slice(0, 100)}`);
      }
    } catch (err: any) {
      console.warn(`  ⚠ ${job.agent_id}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\nChecking final reputation scores:');
  try {
    const res = await fetch(`${REGISTRY_URL}/agents`);
    if (res.ok) {
      const agents = await res.json();
      for (const a of agents) {
        console.log(`  [${a.agent_id}] score=${a.reputation.score} jobs=${a.reputation.total_jobs}`);
      }
    }
  } catch {
    console.warn('  Could not fetch agents from registry');
  }
}

seedFeedback().catch(console.error);
