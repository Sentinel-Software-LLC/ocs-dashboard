"use client";
/* eslint-disable @typescript-eslint/no-unused-vars, prefer-const */

import { useState, useEffect } from "react";
import { getApiHeaders } from "@/lib/api";
import InfoTooltip from "./InfoTooltip";
import {
  POLICY_SETTINGS,
  PRESET_VALUES,
  type PolicySettingDef,
} from "@/types/policySettings";

const API_BASE = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_ENGINE_URL ? process.env.NEXT_PUBLIC_ENGINE_URL : "http://localhost:8080") + "/api/PGTAIL";

/** Curated demo addresses that exhibit different behaviors for policy configuration. */
const DEMO_ADDRESSES: { address: string; label: string; behavior: string; network: string }[] = [
  { address: "test_trusted_partner", label: "Trusted Partner", behavior: "C7/E4 — Sweet spot, auto-approval", network: "Mock" },
  { address: "test_mature_wallet", label: "Mature Wallet", behavior: "E7 — Mature history, control group", network: "Mock" },
  { address: "test_peeling_chain", label: "Peeling Chain", behavior: "E6 — Layering detection, fast-drain", network: "Mock" },
  { address: "test_virgin_wallet", label: "Virgin Wallet", behavior: "E7 — Zero history, BLOCKED", network: "Mock" },
  { address: "rff5UDgUy9NvcpDNWUqw4jwFMoXWu855Nt", label: "Blacklist", behavior: "B2 — Known scammer, always blocked", network: "XRP" },
  { address: "test_community_verified", label: "Community Verified", behavior: "T-8.1 social rules", network: "Mock" },
  { address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", label: "Genesis Admin", behavior: "Sovereign admin", network: "ETH" },
];

function truncateAddress(addr: string, head = 8, tail = 6): string {
  if (addr.length <= 24) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

type DefensePosture = "CurrentSettings" | "ZeroTrust" | "CommunityTrust" | "Institutional" | "Custom";

/** Order: Current Settings (read from DB), then presets, then Custom. Custom inherits from last selected preset. */
const POSTURES: { id: DefensePosture; profileId: number | null; title: string; description: string }[] = [
  { id: "CurrentSettings", profileId: null, title: "Current Settings", description: "Read from database. Shows what is deployed for this address." },
  { id: "ZeroTrust", profileId: 0, title: "Zero-Trust", description: "Maximum security. Every transaction requires MFA. No exceptions." },
  { id: "CommunityTrust", profileId: 1, title: "Community-Trust", description: "Balanced security. Auto-approves low-risk transactions to known entities." },
  { id: "Institutional", profileId: 3, title: "Institutional", description: "Relaxed for high-volume. Cap=$100K, Risk≤50, Confidence≥60%." },
  { id: "Custom", profileId: 2, title: "Custom", description: "Sovereign control. Sliders from Zero-Trust to your current/custom values." },
];

type SettingsState = Record<string, number>;

function getInitialSettings(posture: DefensePosture): SettingsState {
  const preset = PRESET_VALUES[posture] ?? PRESET_VALUES.ZeroTrust;
  const out: SettingsState = {};
  for (const s of POLICY_SETTINGS) {
    out[s.key] = preset[s.key] ?? 0;
  }
  return out;
}

interface SovereignConfiguratorProps {
  targetAddress?: string;
  onAddressChange?: (address: string) => void;
  onExerciseSuccess?: () => void;
}

export default function SovereignConfigurator({
  targetAddress = "",
  onAddressChange,
  onExerciseSuccess,
}: SovereignConfiguratorProps) {
  const [address, setAddress] = useState(targetAddress);
  const [useCustomAddress, setUseCustomAddress] = useState(false);
  const [selectedPosture, setSelectedPosture] = useState<DefensePosture>("CurrentSettings");
  const [settings, setSettings] = useState<SettingsState>(() => getInitialSettings("CommunityTrust"));
  /** Last preset selected (for Custom inheritance). Excludes CurrentSettings and Custom. */
  const [lastPresetSelected, setLastPresetSelected] = useState<DefensePosture>("CommunityTrust");
  const [deploying, setDeploying] = useState(false);
  const [deploySuccess, setDeploySuccess] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    trustRange: true,
    dust: true,
    peeling: true,
  });
  /** B1: Amount (USD) above which hardware wallet is required. Null/0 = no requirement. Custom posture only. */
  const [hardwareWalletRequiredAbove, setHardwareWalletRequiredAbove] = useState<number | null>(null);
  /** True when DB has Custom (profile 2) for this address — enables Generate Policy Tests. */
  const [isCustomStored, setIsCustomStored] = useState(false);
  const [policyTestsLoading, setPolicyTestsLoading] = useState(false);
  const [policyTestResults, setPolicyTestResults] = useState<{ outcome: string; expected: string; pass: boolean }[] | null>(null);

  useEffect(() => {
    setAddress(targetAddress);
    setUseCustomAddress(!DEMO_ADDRESSES.some((d) => d.address.toLowerCase() === targetAddress.toLowerCase()));
  }, [targetAddress]);

  useEffect(() => {
    if (!address.trim()) {
      setSelectedPosture("CurrentSettings");
      setSettings(getInitialSettings("CommunityTrust"));
      return;
    }
    const loadEntry = async () => {
      try {
        const res = await fetch(`${API_BASE}/registry`, { headers: await getApiHeaders() });
        const entries = await res.json();
        const entry = entries.find(
          (e: { hexAddress: string }) => e.hexAddress?.toLowerCase() === address.toLowerCase()
        );
        if (entry) {
          const profile = entry.trustProfile ?? 1;
          let merged: SettingsState = {};
          const preset = PRESET_VALUES.CommunityTrust;
          for (const s of POLICY_SETTINGS) {
            const raw = entry[s.key] ?? (entry as Record<string, unknown>)[s.key.charAt(0).toUpperCase() + s.key.slice(1)];
            const v = Number(raw);
            merged[s.key] = Number.isFinite(v) ? v : (preset[s.key] ?? s.min);
          }
          let overrides: Record<string, number> = {};
          try {
            const raw = entry.policyOverrides ?? entry.PolicyOverrides;
            if (typeof raw === "string") overrides = JSON.parse(raw);
            else if (raw && typeof raw === "object") overrides = raw as Record<string, number>;
          } catch { /* ignore */ }
          for (const s of POLICY_SETTINGS) {
            if (overrides[s.key] != null) merged[s.key] = overrides[s.key];
          }
          setSettings(merged);
          setHardwareWalletRequiredAbove(entry.hardwareWalletRequiredAbove != null ? Number(entry.hardwareWalletRequiredAbove) : null);
          setSelectedPosture("CurrentSettings"); // Default: show what's in DB
          setIsCustomStored(profile === 2);
        } else {
          setSelectedPosture("CurrentSettings");
          setSettings(getInitialSettings("CommunityTrust"));
          setHardwareWalletRequiredAbove(null);
          setIsCustomStored(false);
        }
      } catch {
        setSelectedPosture("CurrentSettings");
        setSettings(getInitialSettings("CommunityTrust"));
        setIsCustomStored(false);
      }
    };
    loadEntry();
  }, [address]);

  const runPolicyTests = async () => {
    if (!address.trim()) return;
    setPolicyTestsLoading(true);
    setPolicyTestResults(null);
    const cap = settings.sovereignCap ?? 500;
    const allowAmt = Math.max(1, Math.floor(cap * 0.5));
    const warnAmt = Math.max(allowAmt + 1, Math.floor(cap * 2));
    const scenarios = [
      { label: "ALLOW", body: { FromAddress: "test_trusted_partner", ToAddress: "test_mature_wallet", Amount: String(allowAmt) }, expected: "APPROVED" },
      { label: "WARN (MFA)", body: { FromAddress: "test_trusted_partner", ToAddress: "test_mature_wallet", Amount: String(warnAmt) }, expected: "MFA" },
      { label: "BLOCKED", body: { FromAddress: "test_peeling_chain", ToAddress: "rff5udguy9nvcpdnwuqw4jwfmoxwu855nt", Amount: "1" }, expected: "BLOCKED" },
    ];
    const results: { outcome: string; expected: string; pass: boolean }[] = [];
    for (const s of scenarios) {
      try {
        const r = await fetch(`${API_BASE}/check-risk`, {
          method: "POST",
          headers: { ...(await getApiHeaders()), "Content-Type": "application/json" },
          body: JSON.stringify(s.body),
        });
        const actual = r.status === 200 ? "APPROVED" : r.status === 202 ? "MFA" : "BLOCKED";
        results.push({ outcome: actual, expected: s.expected, pass: actual === s.expected });
      } catch {
        results.push({ outcome: "BLOCKED", expected: s.expected, pass: s.expected === "BLOCKED" });
      }
    }
    setPolicyTestResults(results);
    onExerciseSuccess?.();
    setPolicyTestsLoading(false);
  };

  const showToast = (message: string, success: boolean) => {
    setToast({ message, success });
    setTimeout(() => setToast(null), 4000);
  };

  const validate = (): string | null => {
    for (const s of POLICY_SETTINGS) {
      const v = settings[s.key];
      if (v == null || v < s.min || v > s.max)
        return `${s.label} must be between ${s.min} and ${s.max}.`;
    }
    if (!address.trim()) return "Enter a target address.";
    return null;
  };

  const handleDeploy = async () => {
    setDeployError(null);
    setDeploySuccess(false);
    if (selectedPosture === "CurrentSettings") {
      setDeployError("Select a preset or Custom to deploy.");
      return;
    }
    const err = validate();
    if (err) {
      setDeployError(err);
      return;
    }

    setDeploying(true);
    try {
      const posture = POSTURES.find((p) => p.id === selectedPosture)!;
      if (posture.profileId == null) return;
      const body: Record<string, unknown> = { trustProfile: posture.profileId };

      if (selectedPosture === "Custom") {
        body.sovereignCap = settings.sovereignCap;
        body.sovereignCapWindowHours = settings.sovereignCapWindowHours;
        body.maxRiskFloor = settings.maxRiskFloor;
        body.blockThreshold = settings.blockThreshold;
        body.minConfidenceCeiling = settings.minConfidenceCeiling;
        body.policyOverrides = settings;
        if (hardwareWalletRequiredAbove != null && hardwareWalletRequiredAbove > 0) {
          body.hardwareWalletRequiredAbove = hardwareWalletRequiredAbove;
        }
      }

      const res = await fetch(
        `${API_BASE}/registry/${encodeURIComponent(address.trim())}/policy`,
        { method: "PUT", headers: { ...await getApiHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Request failed: ${res.status}`);
      }
      showToast("Sovereign Law Updated. Node .20 Synchronized.", true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Deploy failed.", false);
    } finally {
      setDeploying(false);
    }
  };

  const handlePostureClick = (p: (typeof POSTURES)[0]) => {
    setDeploySuccess(false);
    if (p.id === "CurrentSettings") {
      setSelectedPosture("CurrentSettings");
      return; // View-only; settings already loaded from DB
    }
    if (p.id === "Custom") {
      // Custom uses current settings (from DB) as baseline — user can tweak from where they are
      setSelectedPosture("Custom");
      // Don't overwrite settings; they already reflect Current Settings when loaded
      return;
    }
    // Preset: ZeroTrust, CommunityTrust, Institutional
    setLastPresetSelected(p.id);
    setSelectedPosture(p.id);
    setSettings(getInitialSettings(p.id));
    setHardwareWalletRequiredAbove(null);
  };

  const setSetting = (key: string, value: number) => {
    setDeploySuccess(false);
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const SECTION_GROUPS: { key: string; title: string; settings: PolicySettingDef[] }[] = [
    { key: "trustRange", title: "Trust-Range (Auto-Approval Gate)", settings: POLICY_SETTINGS.filter((s) => s.section === "trustRange") },
    { key: "dust", title: "Behavioral: Dusting", settings: POLICY_SETTINGS.filter((s) => s.section === "dust") },
    { key: "peeling", title: "Peeling & Behavioral (History, Confidence Context)", settings: POLICY_SETTINGS.filter((s) => s.section === "peeling") },
  ];

  const formatBound = (v: number, unit?: string) => {
    const s = v >= 1000 ? v.toLocaleString() : String(v);
    return (unit === "$" ? "$" : "") + s + (unit === "%" ? "%" : "") + (unit === "hrs" ? "h" : "") + (unit === "min" ? "m" : "");
  };

  const renderSettingRow = (s: PolicySettingDef, readOnly: boolean) => {
    const preset = PRESET_VALUES.CommunityTrust;
    const displayVal = Number.isFinite(settings[s.key]) ? settings[s.key] : (preset[s.key] ?? s.min);

    return (
      <tr key={s.key} className="border-b border-slate-700/50 last:border-0">
        <td className="py-2 pr-4">
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-slate-300 text-sm">{s.label}</span>
            <InfoTooltip
              title={s.label}
              description={s.description}
              zeroTrust={s.zeroTrust}
              communityTrust={s.communityTrust}
              whereUsed={s.whereUsed}
            />
          </div>
        </td>
        <td className="py-2 px-3 text-right w-24 font-mono text-xs text-slate-500">
          {formatBound(s.min, s.unit)}
        </td>
        <td className="py-2 px-3 w-28">
          {readOnly ? (
            <span className="font-mono text-slate-200 text-sm block text-right">
              {s.unit === "$" && "$"}{displayVal}{s.unit === "%" && "%"}{s.unit === "hrs" && " hrs"}{s.unit === "min" && " min"}
            </span>
          ) : (
            <input
              type="number"
              min={s.min}
              max={s.max}
              step={s.key.includes("Cap") || s.key.includes("Usd") ? 10 : 1}
              value={displayVal}
              onChange={(e) => {
                const v = e.target.value === "" ? s.min : Number(e.target.value);
                setSetting(s.key, Math.min(s.max, Math.max(s.min, Number.isFinite(v) ? v : s.min)));
              }}
              title={`Enter value between ${s.min} and ${s.max}`}
              className="w-full bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm border border-slate-600 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 font-mono text-right"
            />
          )}
        </td>
        <td className="py-2 px-3 text-left w-24 font-mono text-xs text-slate-500">
          {formatBound(s.max, s.unit)}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-slate-400 mb-1">Target Address (Registry Entry)</label>
        <select
          value={useCustomAddress ? "__custom__" : (DEMO_ADDRESSES.find((d) => d.address.toLowerCase() === address.toLowerCase())?.address ?? "__custom__")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__custom__") {
              setUseCustomAddress(true);
              setAddress("");
            } else {
              setUseCustomAddress(false);
              setAddress(v);
              onAddressChange?.(v);
            }
          }}
          className="w-full bg-slate-700 text-slate-200 px-4 py-2 rounded border border-slate-600 focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
        >
          <option value="__custom__">— Custom address —</option>
          {DEMO_ADDRESSES.map((d) => (
            <option key={d.address} value={d.address}>
              [{d.network}] {d.label} — {truncateAddress(d.address)} — {d.behavior}
            </option>
          ))}
        </select>
        {useCustomAddress && (
          <input
            type="text"
            value={address}
            onChange={(e) => { setAddress(e.target.value); onAddressChange?.(e.target.value); }}
            placeholder="0x... or r..."
            className="mt-2 w-full bg-slate-700 text-slate-200 px-4 py-2 rounded border border-slate-600 focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
          />
        )}
      </div>

      <div>
        <p className="text-sm font-bold text-slate-400 mb-3">Defense Posture</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {POSTURES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handlePostureClick(p)}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                selectedPosture === p.id ? "border-red-500 bg-red-900/20" : "border-slate-600 bg-slate-900/50 hover:border-slate-500"
              }`}
            >
              <p className="font-bold text-slate-200">{p.title}</p>
              <p className="text-xs text-slate-500 mt-1">{p.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 rounded-lg border border-slate-600 bg-slate-900/50 space-y-4">
        <p className="text-sm font-bold text-slate-400">
          {selectedPosture === "CurrentSettings" && "Current Settings (from database)"}
          {selectedPosture === "Custom" && "Custom Thresholds — Slider: Zero-Trust to your value"}
          {selectedPosture !== "CurrentSettings" && selectedPosture !== "Custom" && (
            <span>Current Settings ({selectedPosture} preset)</span>
          )}
        </p>

        {SECTION_GROUPS.map((group) => (
          <div key={group.key} className="border border-slate-700 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection(group.key)}
              className="w-full px-4 py-2 text-left text-sm font-medium text-slate-300 bg-slate-800/50 hover:bg-slate-800"
            >
              {expandedSections[group.key] ? "▼" : "▶"} {group.title}
            </button>
            {expandedSections[group.key] && (
              <div className="px-4 py-2 overflow-x-auto">
                <table className="w-full min-w-[28rem]">
                  <thead>
                    <tr className="border-b border-slate-600 text-left">
                      <th className="py-2 pr-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Setting</th>
                      <th className="py-2 px-3 w-24 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Min</th>
                      <th className="py-2 px-3 w-28 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Current</th>
                      <th className="py-2 px-3 w-24 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.settings.map((s) => renderSettingRow(s, selectedPosture !== "Custom" /* Custom = editable */))}
                    {group.key === "trustRange" && selectedPosture === "Custom" && (
                      <tr className="border-b border-slate-700/50">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="text-slate-300 text-sm">Hardware Wallet Required Above (B1)</span>
                            {address.toLowerCase().includes("test_trusted_partner") && (
                              <span className="ml-2 text-[10px] text-amber-400" title="Sovereign Cap must be ≥5000 so B1 triggers (not C7 cap breach)">MVP-2 B1: Institutional→Custom, then 1000</span>
                            )}
                            <InfoTooltip
                              title="Hardware Wallet Required Above"
                              description="Amount (USD) above which a hardware wallet is required. Transactions above this threshold require IsHardwareWallet=true or MFA. 0 or empty = no requirement."
                              zeroTrust="Not used in Zero Trust (all tx require MFA)."
                              communityTrust="Optional; e.g. $10,000 for high-value tx."
                              whereUsed="B1: CheckRisk blocks when amount exceeds threshold and IsHardwareWallet=false."
                            />
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right w-24 font-mono text-xs text-slate-500">$0</td>
                        <td className="py-2 px-3 w-28">
                          <input
                            type="number"
                            min={0}
                            max={10_000_000}
                            value={hardwareWalletRequiredAbove ?? ""}
                            placeholder="None"
                            onChange={(e) => {
                              const v = e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0);
                              setHardwareWalletRequiredAbove(v);
                            }}
                            className="w-full bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm border border-slate-600 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 font-mono text-right"
                          />
                        </td>
                        <td className="py-2 px-3 text-left w-24 font-mono text-xs text-slate-500">$10,000,000</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      <div>
        <button
          onClick={handleDeploy}
          disabled={deploying || selectedPosture === "CurrentSettings"}
          className="w-full bg-red-600 hover:bg-red-500 disabled:bg-slate-600 disabled:cursor-not-allowed px-6 py-3 rounded font-bold text-white transition-all"
        >
          {deploying ? "Deploying…" : selectedPosture === "CurrentSettings" ? "Select a preset or Custom to deploy" : "Deploy Sovereign Law"}
        </button>
        <p className="text-xs text-slate-500 mt-2 text-center">
          Updates the RegistryEntry in the database (in-memory when UseLocalDb, or PostgreSQL on Node .20).
        </p>
      </div>

      {toast && (
        <div
          className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 ${
            toast.success ? "bg-emerald-900/90 text-emerald-200" : "bg-red-900/90 text-red-200"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
