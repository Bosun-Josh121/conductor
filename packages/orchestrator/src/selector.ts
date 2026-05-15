import type { AgentRecord } from '@conductor/common';

export interface ScoredAgent {
  agent: AgentRecord;
  score: number;
  breakdown: {
    capability_match: number;
    reputation: number;
    price_efficiency: number;
    latency_score: number;
    discovery_bonus: number;
  };
}

const WEIGHTS = {
  capability_match: 0.35,
  reputation: 0.30,
  price_efficiency: 0.15,
  latency: 0.10,
  discovery_bonus: 0.10,
};

export function scoreAgents(
  agents: AgentRecord[],
  neededCapabilities: string[],
  maxPriceUSDC: number = 0.10,
): ScoredAgent[] {
  return agents
    .map(agent => {
      const matchCount = neededCapabilities.length === 0
        ? 1
        : neededCapabilities.filter(nc =>
            agent.capabilities.some(ac =>
              ac.toLowerCase().includes(nc.toLowerCase()) ||
              nc.toLowerCase().includes(ac.toLowerCase())
            )
          ).length;
      const capability_match = neededCapabilities.length === 0
        ? 1
        : matchCount / neededCapabilities.length;

      const reputation = (agent.reputation?.score ?? 50) / 100;

      const price = agent.pricing.price_per_call;
      const price_efficiency = maxPriceUSDC > 0
        ? Math.max(0, 1 - price / maxPriceUSDC)
        : 0.5;

      const avgLatency = agent.reputation?.avg_latency_ms ?? 2000;
      const latency_score = Math.max(0, 1 - avgLatency / 10000);

      const totalJobs = agent.reputation?.total_jobs ?? 0;
      const discovery_bonus = totalJobs < 5 ? 1.0 : 0.0;

      const score =
        capability_match * WEIGHTS.capability_match +
        reputation * WEIGHTS.reputation +
        price_efficiency * WEIGHTS.price_efficiency +
        latency_score * WEIGHTS.latency +
        discovery_bonus * WEIGHTS.discovery_bonus;

      return {
        agent,
        score: Math.round(score * 100) / 100,
        breakdown: {
          capability_match: Math.round(capability_match * 100) / 100,
          reputation: Math.round(reputation * 100) / 100,
          price_efficiency: Math.round(price_efficiency * 100) / 100,
          latency_score: Math.round(latency_score * 100) / 100,
          discovery_bonus,
        },
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function selectBestAgent(
  agents: AgentRecord[],
  neededCapabilities: string[],
  maxPriceUSDC?: number,
): ScoredAgent | null {
  const scored = scoreAgents(agents, neededCapabilities, maxPriceUSDC);
  const candidates = neededCapabilities.length === 0
    ? scored
    : scored.filter(s => s.breakdown.capability_match > 0);
  return candidates[0] ?? null;
}
