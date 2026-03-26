"use client";
import { useState } from 'react';
import { getApiHeaders } from '@/lib/api';

export default function CheckRiskForm({ apiBase, onSuccess }: { apiBase: string; onSuccess: () => void }) {
  const [from, setFrom] = useState('test_trusted_partner');
  const [to, setTo] = useState('test_mature_wallet');
  const [amount, setAmount] = useState('100');
  const [maxSlippage, setMaxSlippage] = useState('');
  const [slippage, setSlippage] = useState('');
  const [txType, setTxType] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleSubmit = async () => {
    setLoading(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        FromAddress: from,
        ToAddress: to,
        Amount: amount,
      };
      if (txType) body.TransactionType = txType;
      if (maxSlippage) body.MaxSlippagePercent = parseFloat(maxSlippage);
      if (slippage) body.SlippagePercent = parseFloat(slippage);

      const r = await fetch(`${apiBase}/check-risk`, {
        method: 'POST',
        headers: { ...(await getApiHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.status === 200) {
        const data = await r.json();
        setResult(`Authorized: ${data.precheckVerdict ?? data.trustRangeVerdict ?? 'You may proceed'}`);
        onSuccess();
      } else if (r.status === 202) {
        const data = await r.json();
        setResult(`Requires Authorization: ${data.riskAdvice ?? 'Review and decide'}`);
        onSuccess();
      } else if (r.status === 403) {
        const data = await r.json().catch(() => ({}));
        setResult(`Not Authorized: ${data.description ?? data.riskAdvice ?? 'Review before proceeding'}`);
        onSuccess();
      } else {
        setResult(`Error: ${r.status}`);
      }
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label className="block text-xs text-slate-500 mb-1">From</label>
        <input value={from} onChange={(e) => setFrom(e.target.value)} className="w-48 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm" />
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">To</label>
        <input value={to} onChange={(e) => setTo(e.target.value)} className="w-48 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm" />
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Amount</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} className="w-24 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm" />
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Tx Type</label>
        <select value={txType} onChange={(e) => setTxType(e.target.value)} className="bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm">
          <option value="">—</option>
          <option value="dex_swap">dex_swap</option>
          <option value="bridge">bridge</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Max Slippage % (I2)</label>
        <input value={maxSlippage} onChange={(e) => setMaxSlippage(e.target.value)} placeholder="e.g. 1" className="w-20 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm" />
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Slippage %</label>
        <input value={slippage} onChange={(e) => setSlippage(e.target.value)} placeholder="e.g. 2" className="w-20 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm" />
      </div>
      <button onClick={handleSubmit} disabled={loading} className="bg-red-600 hover:bg-red-500 disabled:opacity-50 px-4 py-2 rounded font-bold text-sm">
        {loading ? '…' : 'Check Risk'}
      </button>
      {result && <span className="text-sm text-slate-300">{result}</span>}
    </div>
  );
}
