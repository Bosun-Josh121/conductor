import { useState } from 'react';
import { Send, DollarSign, Shield, HelpCircle } from 'lucide-react';

interface Props {
  onSubmit: (task: string, budget: number) => void;
  isRunning: boolean;
  humanOverride: boolean;
  onHumanOverrideChange: (v: boolean) => void;
}

const EXAMPLE_TASKS = [
  'Research the latest Stellar blockchain news and summarize the top 3 developments',
  'Analyze the current XLM/USDC trading patterns and identify key trends',
  'Write a report on AI agent adoption in DeFi protocols',
];

export function TaskInput({ onSubmit, isRunning, humanOverride, onHumanOverrideChange }: Props) {
  const [task, setTask] = useState('');
  const [budget, setBudget] = useState(0.5);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim() || isRunning) return;
    onSubmit(task.trim(), budget);
  };

  return (
    <div className="bg-gray-900/60 border border-gray-800/60 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Send size={12} className="text-violet-500" />
        <h2 className="text-xs font-semibold text-gray-300">New Task</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={task}
          onChange={e => setTask(e.target.value)}
          placeholder="Describe what you need AI agents to do..."
          rows={4}
          disabled={isRunning}
          className="w-full bg-gray-950/80 border border-gray-800 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-700 resize-none focus:outline-none focus:border-violet-700/60 disabled:opacity-50"
        />

        {/* Budget */}
        <div className="flex items-center gap-2">
          <DollarSign size={10} className="text-gray-600 shrink-0" />
          <label className="text-xs text-gray-500 shrink-0">Budget (USDC)</label>
          <input
            type="number"
            value={budget}
            onChange={e => setBudget(parseFloat(e.target.value) || 0)}
            min={0.01}
            step={0.1}
            disabled={isRunning}
            className="flex-1 bg-gray-950/80 border border-gray-800 rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-violet-700/60 disabled:opacity-50"
          />
        </div>

        {/* Human override toggle */}
        <div className="flex items-center gap-2 pt-1">
          <Shield size={10} className={humanOverride ? 'text-violet-400' : 'text-gray-700'} />
          <label className="text-xs text-gray-500 flex-1 cursor-pointer" onClick={() => onHumanOverrideChange(!humanOverride)}>
            Human-in-the-loop (you approve milestones)
          </label>
          <button
            type="button"
            onClick={() => onHumanOverrideChange(!humanOverride)}
            className={`w-8 h-4 rounded-full transition-colors relative ${humanOverride ? 'bg-violet-600' : 'bg-gray-700'}`}
          >
            <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${humanOverride ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {humanOverride && (
          <p className="text-xs text-violet-400/70 flex items-start gap-1.5">
            <HelpCircle size={9} className="mt-0.5 shrink-0" />
            Your wallet will be assigned the Approver and Dispute Resolver roles. You will sign those transactions in Freighter.
          </p>
        )}

        <button
          type="submit"
          disabled={isRunning || !task.trim()}
          className="w-full py-2 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-2"
        >
          {isRunning ? (
            <>
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Running…
            </>
          ) : (
            <>
              <Send size={10} />
              Run Task
            </>
          )}
        </button>
      </form>

      {/* Example tasks */}
      <div className="space-y-1">
        <p className="text-xs text-gray-700">Examples:</p>
        {EXAMPLE_TASKS.map((t, i) => (
          <button
            key={i}
            onClick={() => setTask(t)}
            disabled={isRunning}
            className="w-full text-left text-xs text-gray-600 hover:text-gray-400 transition-colors truncate"
          >
            → {t}
          </button>
        ))}
      </div>
    </div>
  );
}
