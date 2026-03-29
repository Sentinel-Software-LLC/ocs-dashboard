"use client";

import { useState, useEffect, useCallback } from "react";
import { getApiHeaders } from "@/lib/api";

const ENGINE_BASE = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_ENGINE_URL
  ? process.env.NEXT_PUBLIC_ENGINE_URL
  : "http://localhost:5193") + "/api/PGTAIL";

type RegistryEntry = {
  id: number;
  hexAddress: string;
  entryType: number; // 0=Blacklist 1=Whitelist
  confidence: number;
  notes: string;
  createdAt: string;
};

type HistoryEntry = {
  id: number;
  observedAt?: string;
  deletedAt?: string;
  actionTaken?: string;
  entryType?: number;
  notes?: string;
  archiveReason?: string;
};

export default function GovernanceTab() {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [address, setAddress] = useState("");
  const [listType, setListType] = useState(1);
  const [confidence, setConfidence] = useState(100);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ success: boolean; message: string } | null>(null);

  const [activeHistory, setActiveHistory] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [pruning, setPruning] = useState<string | null>(null);

  const fetchRegistry = useCallback(async () => {
    try {
      const res = await fetch(`${ENGINE_BASE}/registry`, { headers: await getApiHeaders() });
      if (!res.ok) throw new Error(`Engine returned ${res.status}`);
      const data = await res.json();
      setEntries(Array.isArray(data) ? data : []);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Registry fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRegistry();
    const interval = setInterval(fetchRegistry, 8000);
    return () => clearInterval(interval);
  }, [fetchRegistry]);

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setCommitResult(null);
    try {
      const res = await fetch("/api/governance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, listType, confidence, notes }),
      });
      const data = await res.json();
      if (res.ok) {
        setCommitResult({ success: true, message: data.message ?? "Committed." });
        setAddress(""); setNotes(""); setConfidence(100); setListType(1);
        fetchRegistry();
      } else {
        setCommitResult({ success: false, message: data.error ?? "Commit failed." });
      }
    } catch (e: unknown) {
      setCommitResult({ success: false, message: e instanceof Error ? e.message : "Network error" });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleHistory = async (addr: string) => {
    if (activeHistory === addr) { setActiveHistory(null); return; }
    const res = await fetch(`${ENGINE_BASE}/registry/history/${encodeURIComponent(addr)}`, { headers: await getApiHeaders() });
    setHistory(res.ok ? await res.json() : []);
    setActiveHistory(addr);
  };

  const handlePrune = async (addr: string) => {
    if (!confirm(`Permanently prune ${addr} from the registry?`)) return;
    setPruning(addr);
    const res = await fetch(`/api/governance?address=${encodeURIComponent(addr)}`, { method: "DELETE" });
    if (res.ok) { fetchRegistry(); }
    else { const d = await res.json(); alert(`Prune failed: ${d.error}`); }
    setPruning(null);
  };

  const label = (type: number) => type === 1 ? "WHITELIST" : "BLACKLIST";
  const labelColor = (type: number) => type === 1 ? "text-emerald-400" : "text-red-400";

  return (
    <div className="space-y-8">
      {/* Commit Form */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-slate-800/50 border-b border-slate-700">
          <p className="text-sm font-medium text-slate-300">Sovereign Registry Commit</p>
          <p className="text-xs text-slate-500 mt-0.5">Add or update an address in the whitelist / blacklist. Signed server-side — admin key never leaves the server.</p>
        </div>
        <form onSubmit={handleCommit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Target Address</label>
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="0x... or test_address"
              required
              className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-slate-400"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Registry Action</label>
              <select
                value={listType}
                onChange={e => setListType(Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-slate-400"
              >
                <option value={1}>Whitelist (Pass)</option>
                <option value={0}>Blacklist (Block)</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Confidence (0–100)</label>
              <input
                type="number"
                min={0} max={100}
                value={confidence}
                onChange={e => setConfidence(Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-slate-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Audit Notes / Intel Source</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Example: Phishing relay detected on Etherscan | Jan 2026"
              rows={3}
              className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-slate-400"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-red-700 hover:bg-red-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-2 rounded text-sm transition-colors"
          >
            {submitting ? "Signing & Committing…" : "Sign & Commit to Registry"}
          </button>

          {commitResult && (
            <p className={`text-sm ${commitResult.success ? "text-emerald-400" : "text-red-400"}`}>
              {commitResult.success ? "✓" : "✗"} {commitResult.message}
            </p>
          )}
        </form>
      </div>

      {/* Registry Feed */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-slate-800/50 border-b border-slate-700 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-300">Live Registry</p>
          <span className="text-xs text-slate-500">{entries.length} entries · auto-refreshes every 8s</span>
        </div>

        {loading && <p className="px-4 py-6 text-sm text-slate-500">Loading registry…</p>}
        {error && <p className="px-4 py-4 text-sm text-red-400">⚠ {error}</p>}

        <div className="divide-y divide-slate-700/50">
          {entries.map(entry => (
            <div
              key={entry.id}
              className={`px-4 py-3 space-y-1 ${pruning === entry.hexAddress ? "opacity-40 pointer-events-none" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-bold ${labelColor(entry.entryType)}`}>
                  ● {label(entry.entryType)}
                </span>
                <span className="text-xs text-slate-600">{new Date(entry.createdAt).toLocaleString()}</span>
              </div>

              <p className="font-mono text-sm text-slate-200 break-all">{entry.hexAddress}</p>

              <div className="flex items-center justify-between gap-4 pt-1">
                <div className="text-xs text-slate-500 space-x-3">
                  <span>Confidence: {entry.confidence}%</span>
                  {entry.notes && <span className="text-slate-600">{entry.notes}</span>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={() => toggleHistory(entry.hexAddress)}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    {activeHistory === entry.hexAddress ? "Hide history" : "Audit trail"}
                  </button>
                  {entry.id !== 1 && (
                    <button
                      onClick={() => handlePrune(entry.hexAddress)}
                      className="text-xs text-red-700 hover:text-red-500"
                    >
                      Prune
                    </button>
                  )}
                </div>
              </div>

              {activeHistory === entry.hexAddress && (
                <div className="mt-2 pl-3 border-l-2 border-blue-800 space-y-2">
                  {history.length === 0 ? (
                    <p className="text-xs text-slate-600 italic">No audit history.</p>
                  ) : history.map(h => (
                    <div key={h.id} className="text-xs text-slate-500 space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span>{new Date(h.observedAt || h.deletedAt || Date.now()).toLocaleString()}</span>
                        <span className={`font-bold ${(h.actionTaken?.toUpperCase() === "WHITELIST" || h.entryType === 1) ? "text-emerald-600" : "text-red-700"}`}>
                          {h.actionTaken?.toUpperCase() ?? (h.entryType === 1 ? "WHITELIST" : "BLACKLIST")}
                        </span>
                      </div>
                      <p className="text-slate-600">{h.archiveReason || h.notes || "Forensic log."}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
