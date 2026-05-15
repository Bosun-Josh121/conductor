import { useState } from 'react';
import { CheckCircle, XCircle, Shield, User, Bot, X } from 'lucide-react';
import { useWallet } from '../contexts/WalletProvider';
import { humanApproveMilestone, humanRejectMilestone } from '../lib/api';
import { MarkdownRenderer } from './MarkdownRenderer';

export interface HumanReviewData {
  task_id: string;
  milestone_index: number;
  title: string;
  deliverable: string;
  ai_recommendation: {
    passed: boolean;
    reasoning: string;
    per_criterion?: Array<{ criterion: string; passed: boolean; note: string }>;
  };
  approve_xdr: string;
  contract_id: string;
}

interface Props {
  review: HumanReviewData;
  onDone: () => void;
}

export function HumanMilestoneReview({ review, onDone }: Props) {
  const { signTransaction } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setBusy(true);
    setError(null);
    try {
      // Ask Freighter to sign the approveMilestone XDR
      const signedXdr = await signTransaction(review.approve_xdr, 'Test SDF Network ; September 2015');
      if (!signedXdr) throw new Error('Freighter returned empty signed XDR');

      // Send signed XDR to orchestrator — it submits on-chain and releases funds
      await humanApproveMilestone(review.task_id, review.milestone_index, signedXdr);
      onDone();
    } catch (err: any) {
      setError(err.message ?? 'Signing failed');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    setBusy(true);
    setError(null);
    try {
      await humanRejectMilestone(review.task_id, review.milestone_index);
      onDone();
    } catch (err: any) {
      setError(err.message ?? 'Rejection failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-start justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-gray-900 border border-amber-900/50 rounded-2xl shadow-2xl my-8">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-amber-600/20 border border-amber-600/40 rounded-md flex items-center justify-center">
              <User size={12} className="text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Your review required</p>
              <p className="text-xs text-gray-500">M{review.milestone_index}: {review.title}</p>
            </div>
          </div>
          <button onClick={onDone} disabled={busy} className="text-gray-600 hover:text-gray-400 disabled:opacity-40">
            <X size={14} />
          </button>
        </div>

        {/* AI recommendation banner */}
        <div className={`mx-5 mt-4 rounded-xl px-4 py-3 border flex items-start gap-3 ${
          review.ai_recommendation.passed
            ? 'bg-emerald-950/40 border-emerald-900/50'
            : 'bg-red-950/40 border-red-900/50'
        }`}>
          <Bot size={14} className={review.ai_recommendation.passed ? 'text-emerald-400 mt-0.5 shrink-0' : 'text-red-400 mt-0.5 shrink-0'} />
          <div className="min-w-0">
            <p className={`text-xs font-semibold ${review.ai_recommendation.passed ? 'text-emerald-400' : 'text-red-400'}`}>
              AI recommends: {review.ai_recommendation.passed ? 'Approve' : 'Reject'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{review.ai_recommendation.reasoning}</p>
            {review.ai_recommendation.per_criterion && review.ai_recommendation.per_criterion.length > 0 && (
              <div className="mt-2 space-y-1">
                {review.ai_recommendation.per_criterion.map((c, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-gray-500">
                    {c.passed
                      ? <CheckCircle size={9} className="text-emerald-500 mt-0.5 shrink-0" />
                      : <XCircle size={9} className="text-red-500 mt-0.5 shrink-0" />}
                    <span><span className="font-medium">{c.criterion}:</span> {c.note}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Deliverable */}
        <div className="mx-5 mt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Shield size={9} className="text-gray-600" />
            Agent Deliverable
          </p>
          <div className="bg-gray-950/70 border border-gray-800/60 rounded-xl p-3 max-h-72 overflow-y-auto">
            <MarkdownRenderer content={review.deliverable} />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mt-3 text-xs text-red-400 bg-red-950/40 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div className="px-5 py-4 mt-3 border-t border-gray-800 flex items-center gap-3">
          <button
            onClick={handleReject}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl border border-red-900/60 text-red-400 hover:bg-red-950/40 disabled:opacity-40 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
          >
            <XCircle size={12} />
            Reject Milestone
          </button>
          <button
            onClick={handleApprove}
            disabled={busy || !review.approve_xdr}
            className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
          >
            {busy ? (
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <CheckCircle size={12} />
            )}
            {busy ? 'Signing with Freighter…' : 'Approve & Sign with Freighter'}
          </button>
        </div>

        <p className="text-xs text-gray-700 text-center pb-4 px-5">
          Approving signs the on-chain <span className="text-gray-600">approveMilestone</span> transaction with your Freighter wallet and releases funds to the agent.
          Rejecting triggers an AI arbiter dispute.
        </p>
      </div>
    </div>
  );
}
