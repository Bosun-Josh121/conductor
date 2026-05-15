export interface AgentManifest {
  agent_id: string;
  name: string;
  description: string;
  capabilities: string[];
  pricing: {
    model: 'free';
    price_per_call: number;
    currency: 'USDC';
  };
  endpoint: string;
  stellar_address: string;
  health_check: string;
}

export interface AgentRecord extends AgentManifest {
  registered_at: string;
  last_seen: string;
  status: 'active' | 'inactive' | 'new';
  registered_by?: string;
  reputation: {
    score: number;
    total_jobs: number;
    successful_jobs: number;
    failed_jobs: number;
    avg_quality: number;
    avg_latency_ms: number;
    last_updated: string;
  };
}

export interface AgentFeedback {
  agent_id: string;
  job_id: string;
  success: boolean;
  quality_rating: number;
  latency_ms: number;
  timestamp: string;
}

// ── Conductor-specific milestone and escrow types ──────────────────────────────

export interface MilestoneSpec {
  title: string;
  description: string;        // acceptance criteria live here
  amount: number;             // USDC
  capabilityTags: string[];
}

export interface ExecutionPlan {
  milestones: MilestoneSpec[];
  total_estimated_cost: number;
  reasoning: string;
  selected_agent_id: string | null;
}

export interface MilestoneResult {
  milestone_index: number;
  title: string;
  agent_id: string;
  agent_name: string;
  success: boolean;
  output: string | null;
  evidence: string | null;
  error: string | null;
  verifier_verdict: VerifierVerdict | null;
  dispute_resolution: DisputeResolution | null;
  tx_hashes: {
    mark?: string;
    approve?: string;
    release?: string;
    dispute_start?: string;
    dispute_resolve?: string;
  };
  latency_ms: number;
  timestamp: string;
}

export interface TaskResult {
  task_id: string;
  task: string;
  escrow_contract_id: string | null;
  escrow_viewer_url: string | null;
  status: 'complete' | 'partial' | 'failed';
  milestones: MilestoneResult[];
  final_output: string | null;
  total_cost: number;
  total_time_ms: number;
}

export interface VerifierVerdict {
  passed: boolean;
  reasoning: string;
  per_criterion: Array<{
    criterion: string;
    passed: boolean;
    note: string;
  }>;
}

export interface DisputeResolution {
  winner: 'agent' | 'funder' | 'split';
  reasoning: string;
  agent_pct: number;
  funder_pct: number;
}
