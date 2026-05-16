import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Music2, Zap, Bot, History, PlusCircle, LogOut, ExternalLink,
  AlertTriangle, Shield, CheckCircle, XCircle, Radio,
} from 'lucide-react';
import { WalletProvider, useWallet } from './contexts/WalletProvider';
import { ToastProvider, useToast } from './contexts/ToastContext';
import { ToastContainer } from './components/Toast';
import { ConnectWallet } from './components/ConnectWallet';
import { ActivityFeed } from './components/ActivityFeed';
import { TaskInput } from './components/TaskInput';
import { MilestonePanel } from './components/MilestonePanel';
import { EscrowPanel } from './components/EscrowPanel';
import { PlanApproval, type PendingPlan } from './components/PlanApproval';
import { HumanMilestoneReview, type HumanReviewData } from './components/HumanMilestoneReview';
import { AgentsPage } from './components/AgentsPage';
import { RegisterAgent } from './components/RegisterAgent';
import { TaskHistory } from './components/TaskHistory';
import { FundingPrompt } from './components/FundingPrompt';
import { useWebSocket } from './hooks/useWebSocket';
import { approveTask, rejectTask, submitTask, confirmFunding } from './lib/api';

type Page = 'run' | 'agents' | 'history' | 'register';

const NAV: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
  { id: 'run',      label: 'Run',      icon: <Zap size={11} /> },
  { id: 'agents',   label: 'Agents',   icon: <Bot size={11} /> },
  { id: 'history',  label: 'History',  icon: <History size={11} /> },
  { id: 'register', label: 'Register', icon: <PlusCircle size={11} /> },
];

function RoleWallets() {
  const [wallets, setWallets] = useState<any>(null);
  useEffect(() => {
    fetch('/api/wallets').then(r => r.json()).then(setWallets).catch(() => {});
  }, []);
  if (!wallets) return null;

  return (
    <div className="bg-gray-900/40 border border-gray-800/50 rounded-xl p-3 space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
        <Shield size={9} className="text-emerald-600" />
        AI Role Wallets
      </p>
      {[
        { label: 'Verifier', role: 'Approver', address: wallets.verifier?.address, color: 'text-emerald-500' },
        { label: 'Arbiter', role: 'Dispute Resolver', address: wallets.arbiter?.address, color: 'text-amber-500' },
        { label: 'Platform', role: 'Release Signer', address: wallets.platform?.address, color: 'text-gray-500' },
      ].map(r => (
        <div key={r.label} className="flex items-start justify-between gap-2">
          <div>
            <p className={`text-xs font-medium ${r.color}`}>{r.label}</p>
            <p className="text-xs text-gray-700">{r.role}</p>
          </div>
          {r.address && (
            <a
              href={`https://stellar.expert/explorer/testnet/account/${r.address}`}
              target="_blank" rel="noreferrer"
              className="text-xs text-gray-700 hover:text-gray-400 font-mono flex items-center gap-0.5"
            >
              {r.address.slice(0, 4)}…{r.address.slice(-4)}
              <ExternalLink size={7} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function Dashboard() {
  const { publicKey, disconnect } = useWallet();
  const { addToast } = useToast();

  const [page, setPage]              = useState<Page>('run');
  const [isRunning, setIsRunning]    = useState(false);
  const [hasResult, setHasResult]    = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [fundingInfo, setFundingInfo] = useState<{ task_id: string; contract_id: string; viewer_url: string; total_usdc: number; fund_xdr?: string; funder_address?: string } | null>(null);
  const [humanReview, setHumanReview] = useState<HumanReviewData | null>(null);
  const [humanOverride, setHumanOverride] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);

  const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
  const { events, connected, clearEvents } = useWebSocket(WS_URL);

  // Only show events that belong to the task this session started.
  // This prevents events from other users' concurrent tasks leaking into the feed.
  const taskEvents = useMemo(() => {
    if (!currentTaskId) return events;
    return events.filter(e => !e.data?.task_id || e.data.task_id === currentTaskId);
  }, [events, currentTaskId]);

  const handleClearEvents = useCallback(() => {
    clearEvents();
    setCurrentTaskId(null);
  }, [clearEvents]);

  const handleSubmit = useCallback(async (task: string, budget: number) => {
    setIsRunning(true);
    setHasResult(false);
    clearEvents();
    setCurrentTaskId(null);
    try {
      const result = await submitTask(task, budget, publicKey ?? undefined, {
        humanOverrideApprover: humanOverride ? publicKey ?? undefined : undefined,
        humanOverrideResolver: humanOverride ? publicKey ?? undefined : undefined,
      });
      // Capture the task_id so we only show events from this specific task
      if (result?.task_id) setCurrentTaskId(result.task_id);
    } catch {
      setIsRunning(false);
      addToast('Task submission failed', 'error');
    }
  }, [publicKey, clearEvents, addToast, humanOverride]);

  useEffect(() => {
    const e = taskEvents[0]; // most recent event for THIS session's task
    if (!e) return;
    if (['task_complete', 'task_error', 'task_result', 'task_infeasible'].includes(e.event)) {
      setIsRunning(false);
      setFundingInfo(null);
    }
    if (e.event === 'human_review_required') setHumanReview(e.data as HumanReviewData);
    if (['human_approved', 'human_rejected', 'milestone_released', 'dispute_resolved'].includes(e.event)) setHumanReview(null);
    if (e.event === 'plan_approval_required') setPendingPlan(e.data as PendingPlan);
    if (['plan_approved', 'plan_rejected', 'plan_auto_approved'].includes(e.event)) setPendingPlan(null);
    if (e.event === 'funding_required') {
      setFundingInfo({ task_id: e.data?.task_id ?? '', contract_id: e.data?.contract_id ?? '', viewer_url: e.data?.viewer_url ?? '', total_usdc: e.data?.total_usdc ?? 0, fund_xdr: e.data?.fund_xdr, funder_address: e.data?.funder_address });
    }
    if (e.event === 'escrow_funded') setFundingInfo(null);
    if (e.event === 'task_result') {
      setHasResult(true);
      const r = e.data;
      if (r?.status === 'complete') addToast(`Done — $${r.total_cost?.toFixed(4)} USDC`, 'success');
      else if (r?.status === 'partial') addToast('Partial — some milestones failed', 'warning');
    }
    if (e.event === 'task_error') addToast(`Failed: ${e.data?.error ?? 'unknown'}`, 'error');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskEvents]);

  const handleFundingConfirm = async (taskId: string) => {
    try {
      await confirmFunding(taskId);
      addToast('Funding confirmed', 'success');
      setFundingInfo(null);
    } catch (err: any) {
      addToast(`Error: ${err.message}`, 'error');
    }
  };

  const escrowUrl = taskEvents.find(e => e.event === 'escrow_deployed')?.data?.viewer_url
    || taskEvents.find(e => e.event === 'task_result')?.data?.escrow_viewer_url;

  return (
    <div className="min-h-screen bg-[#080c10] text-gray-200 flex flex-col">

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-[#080c10]/95 backdrop-blur-xl border-b border-gray-800/60 shrink-0">
        <div className="max-w-screen-xl mx-auto px-5 flex items-center gap-3 h-11">

          {/* Brand */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 bg-gradient-to-br from-emerald-600 to-teal-700 rounded-md flex items-center justify-center">
              <Music2 size={11} className="text-white" />
            </div>
            <span className="text-sm font-bold tracking-tight text-white">Conductor</span>
            <span className="text-xs text-gray-700 hidden md:block">/ AI escrow marketplace</span>
          </div>

          {/* Status pills */}
          {isRunning && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-900/50 text-xs text-emerald-400">
              <Radio size={8} className="animate-pulse" />
              Agents working
            </div>
          )}
          {pendingPlan && !isRunning && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-950/60 border border-blue-900/50 text-xs text-blue-400">
              <Zap size={8} className="animate-pulse" />
              Plan ready
            </div>
          )}
          {fundingInfo && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-950/60 border border-amber-900/50 text-xs text-amber-400">
              <AlertTriangle size={8} />
              Awaiting escrow fund
            </div>
          )}

          <div className="flex-1" />

          {/* Escrow viewer shortcut when active */}
          {escrowUrl && (
            <a
              href={escrowUrl}
              target="_blank" rel="noreferrer"
              className="hidden md:flex items-center gap-1 text-xs text-emerald-500 hover:text-emerald-400 transition-colors"
            >
              <ExternalLink size={9} />
              Escrow Viewer
            </a>
          )}

          {/* Nav */}
          <nav className="flex items-center gap-0.5">
            {NAV.map(n => (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  page === n.id
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-600 hover:text-gray-300 hover:bg-gray-800/40'
                }`}
              >
                {n.icon}
                <span className="hidden sm:inline">{n.label}</span>
                {n.id === 'run' && hasResult && !isRunning && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            ))}
          </nav>

          {/* Wallet */}
          <div className="flex items-center gap-2 pl-3 border-l border-gray-800/60 shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-600 animate-pulse'}`} />
            {publicKey && (
              <>
                <span className="text-xs text-gray-600 font-mono hidden lg:block">{publicKey.slice(0, 4)}…{publicKey.slice(-4)}</span>
                <button onClick={disconnect} title="Disconnect wallet" className="text-gray-700 hover:text-gray-400 transition-colors">
                  <LogOut size={11} />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Pages ── */}
      <main className="flex-1 max-w-screen-xl w-full mx-auto px-4 py-5">

        {page === 'run' && (
          <div className="grid grid-cols-12 gap-4 items-start">
            {/* Left col: task input */}
            <div className="col-span-12 lg:col-span-4 xl:col-span-3 space-y-3">
              <TaskInput
                onSubmit={handleSubmit}
                isRunning={isRunning}
                humanOverride={humanOverride}
                onHumanOverrideChange={setHumanOverride}
              />
              <RoleWallets />
            </div>

            {/* Center col: live feed */}
            <div className="col-span-12 lg:col-span-5 xl:col-span-6 space-y-3">
              <ActivityFeed events={taskEvents} connected={connected} onClear={handleClearEvents} />
              {hasResult && <MilestonePanel events={taskEvents} />}
            </div>

            {/* Right col: escrow */}
            <div className="col-span-12 lg:col-span-3 space-y-3">
              <EscrowPanel events={taskEvents} />
              <EscrowStats events={taskEvents} isRunning={isRunning} />
            </div>
          </div>
        )}

        {page === 'agents' && <AgentsPage onRegisterClick={() => setPage('register')} />}
        {page === 'history' && <TaskHistory />}
        {page === 'register' && <div className="max-w-2xl mx-auto"><RegisterAgent /></div>}
      </main>

      {/* ── Modals ── */}
      {pendingPlan && (
        <PlanApproval
          plan={pendingPlan}
          onApprove={() => approveTask(pendingPlan.task_id).then(() => setPendingPlan(null))}
          onReject={() => rejectTask(pendingPlan.task_id).then(() => setPendingPlan(null))}
          onDismiss={() => setPendingPlan(null)}
        />
      )}
      {humanReview && (
        <HumanMilestoneReview
          review={humanReview}
          onDone={() => setHumanReview(null)}
        />
      )}
      {fundingInfo && (
        <FundingPrompt
          taskId={fundingInfo.task_id}
          contractId={fundingInfo.contract_id}
          viewerUrl={fundingInfo.viewer_url}
          totalUsdc={fundingInfo.total_usdc}
          fundXdr={fundingInfo.fund_xdr}
          funderAddress={fundingInfo.funder_address}
          onConfirm={() => setFundingInfo(null)}
          onDismiss={() => setFundingInfo(null)}
        />
      )}
      <ToastContainer />
    </div>
  );
}

// Live task stats strip shown in right column
function EscrowStats({ events, isRunning }: { events: any[]; isRunning: boolean }) {
  const result = events.find(e => e.event === 'task_result')?.data;
  const deployed = events.find(e => e.event === 'escrow_deployed');

  if (!deployed && !isRunning) return null;

  const milestones = events.filter(e => e.event === 'milestone_started');
  const released   = events.filter(e => e.event === 'milestone_released');
  const rejected   = events.filter(e => e.event === 'milestone_rejected');
  const disputes   = events.filter(e => e.event === 'dispute_resolved');

  return (
    <div className="bg-gray-900/40 border border-gray-800/50 rounded-xl p-3 space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">This Run</p>
      <div className="grid grid-cols-2 gap-1.5">
        {[
          { label: 'Milestones', value: milestones.length, icon: <Zap size={8} className="text-gray-500" /> },
          { label: 'Released', value: released.length, icon: <CheckCircle size={8} className="text-emerald-500" /> },
          { label: 'Rejected', value: rejected.length, icon: <XCircle size={8} className="text-red-500" /> },
          { label: 'Disputes', value: disputes.length, icon: <Shield size={8} className="text-amber-500" /> },
        ].map(s => (
          <div key={s.label} className="bg-gray-950/40 rounded-lg p-2 flex items-center gap-1.5">
            {s.icon}
            <div>
              <p className="text-xs font-semibold text-gray-200">{s.value}</p>
              <p className="text-xs text-gray-700">{s.label}</p>
            </div>
          </div>
        ))}
      </div>
      {result && (
        <div className={`rounded-lg px-2 py-1.5 text-xs font-medium ${
          result.status === 'complete' ? 'bg-emerald-950/40 text-emerald-400' :
          result.status === 'partial' ? 'bg-amber-950/40 text-amber-400' :
          'bg-red-950/40 text-red-400'
        }`}>
          {result.status} · ${result.total_cost?.toFixed(4)} USDC · {((result.total_time_ms ?? 0) / 1000).toFixed(0)}s
        </div>
      )}
    </div>
  );
}

function AppInner() {
  const { isConnected, isLoading } = useWallet();
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#080c10] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!isConnected) return <ConnectWallet />;
  return <Dashboard />;
}

export default function App() {
  return (
    <WalletProvider>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </WalletProvider>
  );
}
