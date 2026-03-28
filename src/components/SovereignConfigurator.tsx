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

const API_BASE = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_ENGINE_URL ? process.env.NEXT_PUBLIC_ENGINE_URL : "http://localhost:5193") + "/api/PGTAIL";

type DefensePosture = "CurrentSettings" | "ZeroTrust" | "CommunityTrust" | "Institutional" | "Custom";

/** Stored in PolicyOverrides.listEnforcement; engine: Block = 403 when ToAddress matches that list type; Allow = risk signal only. */
type ListEnforcementState = { blacklist: "block" | "allow"; graylist: "block" | "allow"; whitelist: "block" | "allow" };


/** Per-posture minimum inbound tx threshold defaults (USD). Null = disabled.
 *  Dusting is typically $0.001–$0.10. Threshold sits just above real dust,
 *  well below any legitimate small payment. */
const POSTURE_DUST_THRESHOLDS: Partial<Record<DefensePosture, number | null>> = {
  ZeroTrust:      1.00,  // $1.00 — maximum vigilance; flags anything under a dollar
  CommunityTrust: 0.10,  // $0.10 — covers BTC/ETH/SOL dust range without flagging real small payments
  Institutional:  0.25,  // $0.25 — slightly above ETH token dust; institutional wallets are higher-value targets
  Custom:         null,  // user-defined from scratch
};

/** Community / Institutional presets: greylist is a risk signal only unless you set Block. */
const DEFAULT_LIST_ENFORCEMENT: ListEnforcementState = {
  blacklist: "block",
  graylist: "allow",
  whitelist: "allow",
};

/** Zero-Trust preset: greylist destinations get an immediate deny (same as blacklist) unless you switch to Allow. */
const ZERO_TRUST_LIST_ENFORCEMENT: ListEnforcementState = {
  blacklist: "block",
  graylist: "block",
  whitelist: "allow",
};

function listEnforcementForTrustProfileId(profileId: number): ListEnforcementState {
  return profileId === 0 ? ZERO_TRUST_LIST_ENFORCEMENT : DEFAULT_LIST_ENFORCEMENT;
}

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
  /** User's address — policy applies when this address sends. Set by wallet connect or session. */
  targetAddress: string;
  onExerciseSuccess?: () => void;
  /** When registry changes (e.g. after profile update), refetch current settings from API. */
  registry?: unknown[];
  /** Increment after MVP auto-configure (seed) so Current Settings reloads even if registry reference is stable. */
  registryRefreshVersion?: number;
  incidentSwitchEnabled?: boolean;
  incidentSwitchLoading?: boolean;
  onToggleIncidentSwitch?: () => void;
}

export default function SovereignConfigurator({
  targetAddress,
  onExerciseSuccess,
  registry,
  registryRefreshVersion = 0,
  incidentSwitchEnabled = false,
  incidentSwitchLoading = false,
  onToggleIncidentSwitch,
}: SovereignConfiguratorProps) {
  const address = targetAddress;
  const [selectedPosture, setSelectedPosture] = useState<DefensePosture>("CurrentSettings");
  const [settings, setSettings] = useState<SettingsState>(() => getInitialSettings("CommunityTrust"));
  /** DB values — never overwritten when user clicks a preset. Current Settings always shows this. */
  const [currentSettingsFromDb, setCurrentSettingsFromDb] = useState<SettingsState>(() => getInitialSettings("CommunityTrust"));
  /** Last preset selected (for Custom inheritance). Excludes CurrentSettings and Custom. */
  const [lastPresetSelected, setLastPresetSelected] = useState<DefensePosture>("CommunityTrust");
  const [deploying, setDeploying] = useState(false);
  const [deploySuccess, setDeploySuccess] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    listEnforcement: true,
    trustRange: true,
    dust: true,
    peeling: true,
  });
  /** Inbound dust protection: MFA required when inbound amount is below this USD threshold. Null/0 = disabled. */
  const [inboundDustThresholdUsd, setInboundDustThresholdUsd] = useState<number | null>(null);
  /** B1: Amount (USD) above which hardware wallet is required. Null/0 = no requirement. Custom posture only. */
  const [hardwareWalletRequiredAbove, setHardwareWalletRequiredAbove] = useState<number | null>(null);
  /** True when DB has Custom (profile 2) for this address — enables Generate Policy Tests. */
  const [isCustomStored, setIsCustomStored] = useState(false);
  const [policyTestsLoading, setPolicyTestsLoading] = useState(false);
  const [policyTestResults, setPolicyTestResults] = useState<{ outcome: string; expected: string; pass: boolean }[] | null>(null);
  const [toast, setToast] = useState<{ message: string; success: boolean } | null>(null);
  const [listEnforcement, setListEnforcement] = useState<ListEnforcementState>(DEFAULT_LIST_ENFORCEMENT);

  useEffect(() => {
    if (!address.trim()) {
      const fallback = getInitialSettings("CommunityTrust");
      setCurrentSettingsFromDb(fallback);
      setSelectedPosture("CurrentSettings");
      setSettings(fallback);
      setListEnforcement(DEFAULT_LIST_ENFORCEMENT);
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
          let rawOverrides: Record<string, unknown> = {};
          try {
            const raw = entry.policyOverrides ?? entry.PolicyOverrides;
            if (typeof raw === "string") rawOverrides = JSON.parse(raw) as Record<string, unknown>;
            else if (raw && typeof raw === "object") rawOverrides = raw as Record<string, unknown>;
          } catch { /* ignore */ }
          for (const s of POLICY_SETTINGS) {
            const v = rawOverrides[s.key];
            if (typeof v === "number" && Number.isFinite(v)) merged[s.key] = v;
          }
          const le = rawOverrides.listEnforcement as Record<string, string> | undefined;
          if (le && typeof le === "object") {
            setListEnforcement({
              blacklist: le.blacklist === "allow" ? "allow" : "block",
              graylist: le.graylist === "block" ? "block" : "allow",
              whitelist: le.whitelist === "block" ? "block" : "allow",
            });
          } else {
            setListEnforcement(listEnforcementForTrustProfileId(profile));
          }
          const dt = rawOverrides.inboundDustThresholdUsd;
          setInboundDustThresholdUsd(typeof dt === "number" && dt > 0 ? dt : null);
          setCurrentSettingsFromDb(merged);
          setSettings(merged);
          setHardwareWalletRequiredAbove(entry.hardwareWalletRequiredAbove != null ? Number(entry.hardwareWalletRequiredAbove) : null);
          setSelectedPosture("CurrentSettings"); // Default: show what's in DB
          setIsCustomStored(profile === 2);
        } else {
          const fallback = getInitialSettings("CommunityTrust");
          setCurrentSettingsFromDb(fallback);
          setSelectedPosture("CurrentSettings");
          setSettings(fallback);
          setHardwareWalletRequiredAbove(null);
          setIsCustomStored(false);
          setListEnforcement(DEFAULT_LIST_ENFORCEMENT);
          setInboundDustThresholdUsd(null);
        }
      } catch {
        const fallback = getInitialSettings("CommunityTrust");
        setCurrentSettingsFromDb(fallback);
        setSelectedPosture("CurrentSettings");
        setSettings(fallback);
        setIsCustomStored(false);
        setListEnforcement(DEFAULT_LIST_ENFORCEMENT);
        setInboundDustThresholdUsd(null);
      }
    };
    loadEntry();
  }, [address, registry, registryRefreshVersion]);

  const runPolicyTests = async () => {
    if (!address.trim()) return;
    setPolicyTestsLoading(true);
    setPolicyTestResults(null);
    const cap = settings.sovereignCap ?? 500;
    const allowAmt = Math.max(1, Math.floor(cap * 0.5));
    const warnAmt = Math.max(allowAmt + 1, Math.floor(cap * 2));
    const scenarios = [
      { label: "Low risk", body: { FromAddress: "test_trusted_partner", ToAddress: "test_mature_wallet", Amount: String(allowAmt) }, expected: "APPROVED" },
      { label: "Moderate risk", body: { FromAddress: "test_trusted_partner", ToAddress: "test_mature_wallet", Amount: String(warnAmt) }, expected: "MFA" },
      { label: "High risk", body: { FromAddress: "test_trusted_partner", ToAddress: "test_blacklisted", Amount: "1" }, expected: "BLOCKED" },
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
      setDeployError("Select a defense posture (Zero-Trust, Community-Trust, Institutional, or Custom), then deploy.");
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
      const body: Record<string, unknown> = {
        trustProfile: posture.profileId,
        sovereignCap: settings.sovereignCap,
        sovereignCapWindowHours: settings.sovereignCapWindowHours,
        maxRiskFloor: settings.maxRiskFloor,
        blockThreshold: settings.blockThreshold,
        minConfidenceCeiling: settings.minConfidenceCeiling,
        policyOverrides: {
          ...settings,
          listEnforcement: { ...listEnforcement },
          ...(inboundDustThresholdUsd != null && inboundDustThresholdUsd > 0
            ? { inboundDustThresholdUsd }
            : {}),
        },
      };
      if (hardwareWalletRequiredAbove != null && hardwareWalletRequiredAbove > 0) {
        body.hardwareWalletRequiredAbove = hardwareWalletRequiredAbove;
      }

      const res = await fetch(
        `${API_BASE}/registry/${encodeURIComponent(address.trim())}/policy`,
        { method: "PUT", headers: { ...await getApiHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Request failed: ${res.status}`);
      }
      setCurrentSettingsFromDb(settings);
      setIsCustomStored(posture.profileId === 2);
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
      setSettings(currentSettingsFromDb); // Always restore actual DB values
      return;
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
    setListEnforcement(p.id === "ZeroTrust" ? ZERO_TRUST_LIST_ENFORCEMENT : DEFAULT_LIST_ENFORCEMENT);
    setInboundDustThresholdUsd(POSTURE_DUST_THRESHOLDS[p.id] ?? null);
    setHardwareWalletRequiredAbove(null);
  };

  const setSetting = (key: string, value: number) => {
    setDeploySuccess(false);
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  /** Editable draft: any posture except read-only Current Settings (deployed snapshot). */
  const canEditDraft = selectedPosture !== "CurrentSettings";

  const resetDraftToPreset = () => {
    if (selectedPosture === "CurrentSettings") return;
    if (selectedPosture === "Custom") {
      setSettings(getInitialSettings("Custom"));
    } else {
      setSettings(getInitialSettings(selectedPosture));
    }
    setListEnforcement({ ...DEFAULT_LIST_ENFORCEMENT });
    setInboundDustThresholdUsd(POSTURE_DUST_THRESHOLDS[selectedPosture] ?? null);
    setHardwareWalletRequiredAbove(null);
    setDeployError(null);
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
        <div className="space-y-1">
          <p className="text-sm font-bold text-slate-400">
            Policy Settings
            {selectedPosture === "CurrentSettings" && " (from database — what is deployed)"}
            {selectedPosture === "Custom" && " — draft (editable)"}
            {selectedPosture !== "CurrentSettings" && selectedPosture !== "Custom" && (
              <span> — {POSTURES.find((x) => x.id === selectedPosture)?.title ?? selectedPosture} draft (editable)</span>
            )}
          </p>
          <p className="text-xs text-slate-500 font-normal font-sans leading-snug">
            Choose a defense posture, adjust sliders and list rules as needed, then deploy. Numeric values and <code className="text-slate-400">listEnforcement</code> are stored in registry columns and <code className="text-slate-400">PolicyOverrides</code>.
          </p>
          {canEditDraft && (
            <button
              type="button"
              onClick={resetDraftToPreset}
              className="mt-2 text-xs font-bold px-3 py-1.5 rounded border border-slate-500 text-slate-300 hover:bg-slate-700/50"
            >
              Reset to preset
            </button>
          )}
        </div>

        <div className="border border-slate-700 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection("listEnforcement")}
            className="w-full px-4 py-2 text-left text-sm font-medium text-slate-300 bg-slate-800/50 hover:bg-slate-800"
          >
            {expandedSections.listEnforcement ? "▼" : "▶"} Registry list enforcement (ToAddress)
          </button>
          {expandedSections.listEnforcement && (
            <div className="px-4 py-3 space-y-3 border-t border-slate-700/80 bg-slate-900/30">
              <p className="text-xs text-slate-500">
                Same policy document as the sliders below. When you send to a <strong>ToAddress</strong> on a registry list: <strong>Block</strong> = immediate deny;
                <strong> Allow</strong> = no list-only deny — risk still runs (MFA / trust-range from your numeric settings). Whitelist <strong>Block</strong> is for testing unusual cases.{' '}
                <strong className="text-slate-400">Zero-Trust</strong> defaults greylist to <strong className="text-slate-400">Block</strong>; Community / Institutional default greylist to <strong className="text-slate-400">Allow</strong> (signal only).
              </p>
              {(["blacklist", "graylist", "whitelist"] as const).map((key) => (
                <div key={key} className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-slate-700/50 last:border-0">
                  <span className="text-sm text-slate-300 capitalize">{key} destination</span>
                  <div className="flex rounded-lg overflow-hidden border border-slate-600">
                    {(["block", "allow"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={!canEditDraft}
                        onClick={() => canEditDraft && setListEnforcement((prev) => ({ ...prev, [key]: mode }))}
                        className={`px-3 py-1.5 text-xs font-bold capitalize ${
                          listEnforcement[key] === mode
                            ? mode === "block"
                              ? "bg-red-900/50 text-red-200"
                              : "bg-emerald-900/40 text-emerald-200"
                            : "bg-slate-800 text-slate-400"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {!canEditDraft && (
                <p className="text-xs text-amber-400/90">Select a <strong>defense posture</strong> (not Current Settings) to edit list rules.</p>
              )}
            </div>
          )}
        </div>

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
                    {group.settings.map((s) => renderSettingRow(s, selectedPosture === "CurrentSettings"))}
                    {group.key === "trustRange" && onToggleIncidentSwitch && (
                      <tr className="border-b border-slate-700/50">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="text-slate-300 text-sm">Allow only Whitelisted recipients</span>
                            <InfoTooltip
                              title="Allow only Whitelisted recipients"
                              description="When ON, all outbound transactions must go to recipients in your whitelist. Non-whitelisted destinations are blocked."
                              zeroTrust="When ON, enforces whitelist-only mode."
                              communityTrust="When ON, enforces whitelist-only mode."
                              whereUsed="Blocks all non-whitelisted recipients when enabled."
                            />
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right w-24 font-mono text-xs text-slate-500">—</td>
                        <td className="py-2 px-3 w-28">
                          {canEditDraft ? (
                            <div className="flex items-center gap-2 justify-end">
                              <button
                                onClick={onToggleIncidentSwitch}
                                disabled={incidentSwitchLoading}
                                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${incidentSwitchEnabled ? "bg-amber-600" : "bg-slate-600"}`}
                              >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${incidentSwitchEnabled ? "translate-x-6" : "translate-x-1"}`} />
                              </button>
                              <span className="text-xs text-slate-500">{incidentSwitchEnabled ? "ON" : "OFF"}</span>
                            </div>
                          ) : (
                            <span className="font-mono text-slate-200 text-sm block text-right">
                              {incidentSwitchEnabled ? "ON" : "OFF"}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-left w-24 font-mono text-xs text-slate-500">—</td>
                      </tr>
                    )}
                    {group.key === "trustRange" && (
                      <tr className="border-b border-slate-700/50">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="text-slate-300 text-sm">Hardware Wallet Required Above</span>
                            {address.toLowerCase().includes("test_trusted_partner") && canEditDraft && (
                              <span className="ml-2 text-[10px] text-amber-400" title="Sovereign Cap must be ≥5000 for this scenario">MVP-2: Institutional→Custom, then 1000</span>
                            )}
                            <InfoTooltip
                              title="Hardware Wallet Required Above"
                              description="Amount (USD) above which a hardware wallet is required. Transactions above this threshold require IsHardwareWallet=true or MFA. 0 or empty = no requirement."
                              zeroTrust="Not used in Zero Trust (all tx require MFA)."
                              communityTrust="Optional; e.g. $10,000 for high-value tx."
                              whereUsed="CheckRisk blocks when amount exceeds threshold and IsHardwareWallet=false."
                            />
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right w-24 font-mono text-xs text-slate-500">$0</td>
                        <td className="py-2 px-3 w-28">
                          {canEditDraft ? (
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
                          ) : (
                            <span className="font-mono text-slate-200 text-sm block text-right">
                              {hardwareWalletRequiredAbove != null && hardwareWalletRequiredAbove > 0 ? `$${hardwareWalletRequiredAbove}` : "—"}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-left w-24 font-mono text-xs text-slate-500">$10,000,000</td>
                      </tr>
                    )}
                    {group.key === "trustRange" && (
                      <tr className="border-b border-slate-700/50">
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="text-slate-300 text-sm">Min. Inbound Amount</span>
                            <InfoTooltip
                              title="Minimum Inbound Transaction Amount"
                              description="Inbound transactions from unregistered addresses below this amount trigger MFA review. Prevents dusting attacks — micro-deposits used to de-anonymize your wallet by forcing on-chain correlation. Leave empty to disable."
                              zeroTrust="$1.00 default — flags anything under a dollar (maximum vigilance)."
                              communityTrust="$0.10 default — covers typical BTC/ETH/SOL dust range; well below any real small payment."
                              whereUsed="CheckRisk returns MFA_REQUIRED when inbound amount is below threshold. Institutional default: $0.25. Real dusting is typically $0.001–$0.10."
                            />
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right w-24 font-mono text-xs text-slate-500">$0</td>
                        <td className="py-2 px-3 w-28">
                          {canEditDraft ? (
                            <input
                              type="number"
                              min={0}
                              max={10}
                              step={0.01}
                              value={inboundDustThresholdUsd ?? ""}
                              placeholder="Disabled"
                              onChange={(e) => {
                                const v = e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0);
                                setInboundDustThresholdUsd(v);
                              }}
                              className="w-full bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm border border-slate-600 focus:border-slate-500 focus:ring-1 focus:ring-slate-500 font-mono text-right"
                            />
                          ) : (
                            <span className="font-mono text-slate-200 text-sm block text-right">
                              {inboundDustThresholdUsd != null && inboundDustThresholdUsd > 0 ? `$${inboundDustThresholdUsd}` : "—"}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-left w-24 font-mono text-xs text-slate-500">$10</td>
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
          {deploying ? "Deploying…" : selectedPosture === "CurrentSettings" ? "Select a defense posture to deploy" : "Deploy Sovereign Law"}
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
