import { useState } from 'react';
import { Zap, DollarSign, Shield, Info } from 'lucide-react';

interface Props {
  onSubmit: (task: string, budget: number) => void;
  isRunning: boolean;
  humanOverride: boolean;
  onHumanOverrideChange: (v: boolean) => void;
}

// Tasks that match available agent capabilities
const EXAMPLE_TASKS = [
  'Get the current XLM/USDC price from the Stellar DEX and report the latest 5 trades',
  'Fetch the latest blockchain and crypto news and summarize the key headlines',
  'Analyze XLM price trends from the Stellar testnet DEX and identify bullish or bearish signals',
];

export function TaskInput({ onSubmit, isRunning, humanOverride, onHumanOverrideChange }: Props) {
  const [task, setTask] = useState('');
  const [budget, setBudget] = useState(0.3);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim() || isRunning) return;
    onSubmit(task.trim(), budget);
  };

  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Zap size={12} className="text-emerald-500" />
        <h2 className="text-xs font-semibold text-gray-200 uppercase tracking-wider">New Task</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2.5">
        <textarea
          value={task}
          onChange={e => setTask(e.target.value)}
          placeholder="Describe what you need AI agents to do…"
          rows={4}
          disabled={isRunning}
          className="w-full bg-gray-950/60 border border-gray-800 rounded-lg px-3 py-2.5 text-xs text-gray-200 placeholder-gray-700 resize-none focus:outline-none focus:border-emerald-700/50 transition-colors disabled:opacity-50"
        />

        <div className="flex items-center gap-2">
          <DollarSign size={10} className="text-gray-600 shrink-0" />
          <span className="text-xs text-gray-600 shrink-0">Budget (USDC)</span>
          <input
            type="number"
            value={budget}
            onChange={e => setBudget(parseFloat(e.target.value) || 0)}
            min={0.05}
            step={0.05}
            disabled={isRunning}
            className="flex-1 bg-gray-950/60 border border-gray-800 rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-700/50 transition-colors disabled:opacity-50"
          />
        </div>

        {/* Human-in-the-loop toggle */}
        <div className="flex items-center gap-2 border-t border-gray-800/60 pt-2.5">
          <Shield size={9} className={humanOverride ? 'text-amber-400' : 'text-gray-700'} />
          <span
            className="text-xs text-gray-500 flex-1 cursor-pointer select-none"
            onClick={() => onHumanOverrideChange(!humanOverride)}
          >
            Human approves milestones
          </span>
          <button
            type="button"
            onClick={() => onHumanOverrideChange(!humanOverride)}
            className="relative shrink-0 w-10 h-5 rounded-full"
            style={{ backgroundColor: humanOverride ? '#d97706' : '#374151', transition: 'background-color 0.2s' }}
          >
            <span
              className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow"
              style={{ left: humanOverride ? '22px' : '2px', transition: 'left 0.2s ease' }}
            />
          </button>
        </div>

        {humanOverride && (
          <p className="text-xs text-amber-400/70 flex items-start gap-1.5 bg-amber-950/20 rounded-lg px-2 py-1.5">
            <Info size={9} className="mt-0.5 shrink-0" />
            You hold the Approver + Dispute Resolver roles. Freighter will prompt you to sign each milestone approval.
          </p>
        )}

        <button
          type="submit"
          disabled={isRunning || !task.trim()}
          className="w-full py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-2"
        >
          {isRunning ? (
            <>
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Running…
            </>
          ) : (
            <>
              <Zap size={10} />
              Run Task
            </>
          )}
        </button>
      </form>

      <div className="space-y-1.5 border-t border-gray-800/40 pt-2.5">
        <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-widest">Try an example</p>
        {EXAMPLE_TASKS.map((t, i) => (
          <button
            key={i}
            onClick={() => setTask(t)}
            disabled={isRunning}
            className="w-full text-left text-xs text-gray-400 hover:text-emerald-400 bg-gray-950/40 hover:bg-emerald-950/30 border border-gray-800/60 hover:border-emerald-900/60 rounded-lg px-2.5 py-2 transition-all disabled:opacity-40 leading-relaxed"
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
