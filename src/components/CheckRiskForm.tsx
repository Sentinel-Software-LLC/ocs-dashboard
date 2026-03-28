"use client";
import { useState, useEffect } from 'react';
import { getApiHeaders } from '@/lib/api';
import type { ManualTestPreset } from '@/types/mvp1Scenarios';

export default function CheckRiskForm({
  apiBase,
  onSuccess,
  presetVersion = 0,
  preset = null,
  presetLabel = null,
}: {
  apiBase: string;
  onSuccess: () => void;
  presetVersion?: number;
  preset?: ManualTestPreset | null;
  presetLabel?: string | null;
}) {
  const [from, setFrom] = useState('test_trusted_partner');
  const [to, setTo] = useState('test_mature_wallet');
  const [amount, setAmount] = useState('100');
  const [maxSlippage, setMaxSlippage] = useState('');
  const [slippage, setSlippage] = useState('');
  const [txType, setTxType] = useState('');
  const [spenderAddress, setSpenderAddress] = useState('');
  const [bridgeChainId, setBridgeChainId] = useState('');
  const [expectedChainId, setExpectedChainId] = useState('');
  const [tokenContractAddress, setTokenContractAddress] = useState('');
  const [isHardwareWallet, setIsHardwareWallet] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!preset || presetVersion < 1) return;
    setFrom(preset.from);
    setTo(preset.to);
    setAmount(preset.amount);
    setTxType(preset.txType);
    setMaxSlippage(preset.maxSlippage);
    setSlippage(preset.slippage);
    setSpenderAddress(preset.spenderAddress ?? '');
    setBridgeChainId(preset.bridgeChainId ?? '');
    setExpectedChainId(preset.expectedChainId ?? '');
    setTokenContractAddress(preset.tokenContractAddress ?? '');
    setIsHardwareWallet(preset.isHardwareWallet ?? '');
    setResult(null);
  }, [presetVersion, preset]);

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
      if (spenderAddress) body.SpenderAddress = spenderAddress;
      if (bridgeChainId) body.BridgeChainId = parseInt(bridgeChainId, 10);
      if (expectedChainId) body.ExpectedChainId = parseInt(expectedChainId, 10);
      if (tokenContractAddress) body.TokenContractAddress = tokenContractAddress;
      if (isHardwareWallet !== '') body.IsHardwareWallet = isHardwareWallet === 'true';

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

  const showBridgeFields = txType === 'bridge';
  const showSpenderField = txType === 'approval' || txType === 'permit';

  return (
    <div className="space-y-3">
      {presetLabel && presetVersion > 0 && (
        <p className="text-xs text-slate-400">
          Loaded from scenario: <span className="text-slate-300">{presetLabel}</span>
        </p>
      )}
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
            <option value="approval">approval (H1)</option>
            <option value="permit">permit (H2)</option>
            <option value="dex_swap">dex_swap (I2)</option>
            <option value="bridge">bridge (J1)</option>
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

      {/* MVP-2 guard params — shown contextually or when preset populated */}
      {(showSpenderField || showBridgeFields || spenderAddress || bridgeChainId || expectedChainId || tokenContractAddress || isHardwareWallet !== '') && (
        <div className="flex flex-wrap items-end gap-4 pt-2 border-t border-slate-700/50">
          <span className="text-xs text-slate-600 self-center">MVP-2 guards:</span>
          {(showSpenderField || spenderAddress) && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Spender Address (H1/H2)</label>
              <input value={spenderAddress} onChange={(e) => setSpenderAddress(e.target.value)} placeholder="e.g. test_known_drainer" className="w-48 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm" />
            </div>
          )}
          {(showBridgeFields || bridgeChainId) && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Bridge Chain ID (J1)</label>
              <input value={bridgeChainId} onChange={(e) => setBridgeChainId(e.target.value)} placeholder="e.g. 137" className="w-24 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm" />
            </div>
          )}
          {(showBridgeFields || expectedChainId) && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Expected Chain ID (J1)</label>
              <input value={expectedChainId} onChange={(e) => setExpectedChainId(e.target.value)} placeholder="e.g. 137" className="w-24 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm" />
            </div>
          )}
          {tokenContractAddress && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Token Contract (K1)</label>
              <input value={tokenContractAddress} onChange={(e) => setTokenContractAddress(e.target.value)} placeholder="e.g. test_known_drainer" className="w-48 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm" />
            </div>
          )}
          {isHardwareWallet !== '' && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Hardware Wallet (B1)</label>
              <select value={isHardwareWallet} onChange={(e) => setIsHardwareWallet(e.target.value)} className="bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm">
                <option value="">— (omit)</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
