import { useState, useEffect, useCallback } from 'react';
import {
  Music, Zap, Bot, History, PlusCircle, LogOut, ExternalLink,
  AlertTriangle, Shield
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
import { AgentsPage } from './components/AgentsPage';
import { RegisterAgent } from './components/RegisterAgent';
import { TaskHistory } from './components/TaskHistory';
import { FundingPrompt } from './components/FundingPrompt';
import { useWebSocket } from './hooks/useWebSocket';
import { approveTask, rejectTask, submitTask, confirmFunding } from './lib/api';

type Page = 'run' | 'agents' | 'history' | 'register';

const NAV: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
  { id: 'run',      label: 'Run',      icon: <Zap size={12} /> },
  { id: 'agents',   label: 'Agents',   icon: <Bot size={12} /> },
  { id: 'history',  label: 'History',  icon: <History size={12} /> },
  { id: 'register', label: 'Register', icon: <PlusCircle size={12} /> },
];

function Dashboard() {
  const { publicKey, disconnect } = useWallet();
  const { addToast } = useToast();

  const [page, setPage]              = useState<Page>('run');
  const [isRunning, setIsRunning]    = useState(false);
  const [hasResult, setHasResult]    = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [fundingInfo, setFundingInfo] = useState<{ task_id: string; contract_id: string; viewer_url: string; total_usdc: number } | null>(null);
  const [humanOverride, setHumanOverride] = useState(false);

  const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
  const { events, connected, clearEvents } = useWebSocket(WS_URL);

  const handleSubmit = useCallback(async (task: string, budget: number) => {
    setIsRunning(true);
    setHasResult(false);
    clearEvents();
    try {
      await submitTask(task, budget, publicKey ?? undefined, {
        humanOverrideApprover: humanOverride ? publicKey ?? undefined : undefined,
        humanOverrideResolver: humanOverride ? publicKey ?? undefined : undefined,
      });
    } catch {
      setIsRunning(false);
      addToast('Task submission failed', 'error');
    }
  }, [publicKey, clearEvents, addToast, humanOverride]);

  // Process WebSocket events
  useEffect(() => {
    const e = events[0];
    if (!e) return;

    if (['task_complete', 'task_error', 'task_result', 'task_infeasible'].includes(e.event)) {
      setIsRunning(false);
      setFundingInfo(null);
    }
    if (e.event === 'plan_approval_required') setPendingPlan(e.data as PendingPlan);
    if (['plan_approved', 'plan_rejected', 'plan_auto_approved'].includes(e.event)) setPendingPlan(null);

    if (e.event === 'funding_required') {
      setFundingInfo({
        task_id: e.data?.task_id ?? '',
        contract_id: e.data?.contract_id ?? '',
        viewer_url: e.data?.viewer_url ?? '',
        total_usdc: e.data?.total_usdc ?? 0,
      });
    }
    if (e.event === 'escrow_funded') setFundingInfo(null);

    if (e.event === 'task_result') {
      setHasResult(true);
      const r = e.data;
      if (r?.status === 'complete')
        addToast(`Complete — $${r.total_cost?.toFixed(4)} USDC | ${r.escrow_viewer_url ? 'View in Escrow Viewer' : ''}`, 'success');
      else if (r?.status === 'partial')
        addToast('Partially completed — some milestones failed', 'warning');
    }
    if (e.event === 'task_error')
      addToast(`Task failed: ${e.data?.error ?? 'unknown'}`, 'error');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const handleFundingConfirm = async (taskId: string) => {
    try {
      await confirmFunding(taskId);
      addToast('Funding confirmed — execution resuming', 'success');
      setFundingInfo(null);
    } catch (err: any) {
      addToast(`Funding confirm failed: ${err.message}`, 'error');
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col">

      {/* Header */}
      <header className="sticky top-0 z-20 bg-gray-950/95 backdrop-blur-xl border-b border-gray-800/80 shrink-0">
        <div className="max-w-screen-xl mx-auto px-4 flex items-center gap-3 h-12">

          <div className="flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 bg-gradient-to-br from-violet-600 to-indigo-700 rounded-md flex items-center justify-center">
              <Music size={11} className="text-white" />
            </div>
            <span className="text-sm font-bold text-white">Conductor</span>
            <span className="text-xs text-gray-600 hidden md:block">AI Task Marketplace</span>
          </div>

          {isRunning && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-violet-950/60 border border-violet-900/60 text-xs text-violet-400">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              Agents working
            </div>
          )}
          {fundingInfo && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-950/60 border border-amber-900/60 text-xs text-amber-400">
              <AlertTriangle size={9} className="animate-pulse" />
              Awaiting funding
            </div>
          )}
          {pendingPlan && !isRunning && (
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-violet-950/60 border border-violet-900/60 text-xs text-violet-400">
              <Zap size={9} className="animate-pulse" />
              Plan ready for review
            </div>
          )}

          <div className="flex-1" />

          <nav className="hidden sm:flex items-center gap-0.5">
            {NAV.map(n => (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  page === n.id
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                }`}
              >
                {n.icon}
                {n.label}
                {n.id === 'run' && hasResult && !isRunning && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2 pl-3 border-l border-gray-800 shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-500 animate-pulse'}`} />
            {publicKey && (
              <>
                <span className="text-xs text-gray-600 font-mono hidden md:block">{publicKey.slice(0, 4)}…{publicKey.slice(-4)}</span>
                <button onClick={disconnect} title="Disconnect" className="text-gray-700 hover:text-gray-400 transition-colors">
                  <LogOut size={12} />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Pages */}
      <main className="flex-1 max-w-screen-xl w-full mx-auto px-4 py-6">

        {page === 'run' && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-12 gap-4 items-start">

              {/* Left: task input */}
              <div className="col-span-12 lg:col-span-4 space-y-3">
                <TaskInput
                  onSubmit={handleSubmit}
                  isRunning={isRunning}
                  humanOverride={humanOverride}
                  onHumanOverrideChange={setHumanOverride}
                />
              </div>

              {/* Center: live activity feed + milestones */}
              <div className="col-span-12 lg:col-span-5 space-y-4">
                <ActivityFeed
                  events={events}
                  connected={connected}
                  onClear={clearEvents}
                />
                {hasResult && <MilestonePanel events={events} />}
              </div>

              {/* Right: escrow panel */}
              <div className="col-span-12 lg:col-span-3 space-y-4">
                <EscrowPanel events={events} />
                <RoleWallets />
              </div>
            </div>
          </div>
        )}

        {page === 'agents' && (
          <AgentsPage onRegisterClick={() => setPage('register')} />
        )}

        {page === 'history' && <TaskHistory />}

        {page === 'register' && (
          <div className="max-w-2xl mx-auto">
            <RegisterAgent />
          </div>
        )}
      </main>

      {/* Modals */}
      {pendingPlan && (
        <PlanApproval
          plan={pendingPlan}
          onApprove={() => approveTask(pendingPlan.task_id).then(() => setPendingPlan(null))}
          onReject={() => rejectTask(pendingPlan.task_id).then(() => setPendingPlan(null))}
          onDismiss={() => setPendingPlan(null)}
        />
      )}

      {fundingInfo && (
        <FundingPrompt
          taskId={fundingInfo.task_id}
          contractId={fundingInfo.contract_id}
          viewerUrl={fundingInfo.viewer_url}
          totalUsdc={fundingInfo.total_usdc}
          onConfirm={() => handleFundingConfirm(fundingInfo.task_id)}
          onDismiss={() => setFundingInfo(null)}
        />
      )}

      <ToastContainer />
    </div>
  );
}

// Show role wallet addresses
function RoleWallets() {
  const [wallets, setWallets] = useState<any>(null);

  useEffect(() => {
    fetch('/api/wallets').then(r => r.json()).then(setWallets).catch(() => {});
  }, []);

  if (!wallets) return null;

  const roles = [
    { label: 'Platform', role: 'releaseSigner', address: wallets.platform?.address },
    { label: 'Verifier', role: 'approver', address: wallets.verifier?.address },
    { label: 'Arbiter', role: 'disputeResolver', address: wallets.arbiter?.address },
  ];

  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-3 space-y-2">
      <p className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
        <Shield size={10} className="text-violet-500" />
        Role Wallets
      </p>
      {roles.map(r => (
        <div key={r.label} className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-300">{r.label}</p>
            <p className="text-xs text-gray-600">{r.role}</p>
          </div>
          {r.address && (
            <a
              href={`https://stellar.expert/explorer/testnet/account/${r.address}`}
              target="_blank" rel="noreferrer"
              className="text-xs text-gray-500 hover:text-violet-400 font-mono flex items-center gap-0.5"
            >
              {r.address.slice(0, 4)}…{r.address.slice(-4)}
              <ExternalLink size={8} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function AppInner() {
  const { isConnected, isLoading } = useWallet();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
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
