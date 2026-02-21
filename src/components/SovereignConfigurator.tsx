"use client";

import { useState, useEffect } from "react";
import InfoTooltip from "./InfoTooltip";
import {
  POLICY_SETTINGS,
  PRESET_VALUES,
  type PolicySettingDef,
} from "@/types/policySettings";

const API_BASE = "http://localhost:5193/api/PGTAIL";

type DefensePosture = "ZeroTrust" | "CommunityTrust" | "Custom";

const POSTURES: { id: DefensePosture; profileId: number; title: string; description: string }[] = [
  { id: "ZeroTrust", profileId: 0, title: "Zero-Trust", description: "Maximum security. Every transaction requires MFA. No exceptions." },
  { id: "CommunityTrust", profileId: 1, title: "Community-Trust", description: "Balanced security. Auto-approves low-risk transactions to known entities." },
  { id: "Custom", profileId: 2, title: "Custom", description: "Sovereign control. Manually define all thresholds." },
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
}

export default function SovereignConfigurator({
  targetAddress = "",
  onAddressChange,
}: SovereignConfiguratorProps) {
  const [address, setAddress] = useState(targetAddress);
  const [selectedPosture, setSelectedPosture] = useState<DefensePosture>("ZeroTrust");
  const [settings, setSettings] = useState<SettingsState>(() => getInitialSettings("ZeroTrust"));
  const [deploying, setDeploying] = useState(false);
  const [toast, setToast] = useState<{ message: string; success: boolean } | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    trustRange: true,
    dust: true,
    peeling: true,
  });

  useEffect(() => setAddress(targetAddress), [targetAddress]);

  useEffect(() => {
    if (!address.trim()) {
      setSelectedPosture("ZeroTrust");
      setSettings(getInitialSettings("ZeroTrust"));
      return;
    }
    const loadEntry = async () => {
      try {
        const res = await fetch(`${API_BASE}/registry`);
        const entries = await res.json();
        const entry = entries.find(
          (e: { hexAddress: string }) => e.hexAddress?.toLowerCase() === address.toLowerCase()
        );
        if (entry) {
          const profile = entry.trustProfile ?? 0;
          if (profile === 0) {
            setSelectedPosture("ZeroTrust");
            setSettings(getInitialSettings("ZeroTrust"));
          } else if (profile === 1) {
            setSelectedPosture("CommunityTrust");
            setSettings(getInitialSettings("CommunityTrust"));
          } else {
            setSelectedPosture("Custom");
            let overrides: Record<string, number> = {};
            try {
              const raw = entry.policyOverrides ?? entry.PolicyOverrides;
              if (typeof raw === "string") overrides = JSON.parse(raw);
              else if (raw && typeof raw === "object") overrides = raw as Record<string, number>;
            } catch { /* ignore */ }
            const preset = PRESET_VALUES.CommunityTrust;
            const merged: SettingsState = {};
            for (const s of POLICY_SETTINGS) {
              merged[s.key] = overrides[s.key] ?? Number(entry[s.key]) ?? preset[s.key] ?? 0;
            }
            setSettings(merged);
          }
        } else {
          setSelectedPosture("ZeroTrust");
          setSettings(getInitialSettings("ZeroTrust"));
        }
      } catch {
        setSelectedPosture("ZeroTrust");
        setSettings(getInitialSettings("ZeroTrust"));
      }
    };
    loadEntry();
  }, [address]);

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
    const err = validate();
    if (err) {
      showToast(err, false);
      return;
    }

    setDeploying(true);
    try {
      const posture = POSTURES.find((p) => p.id === selectedPosture)!;
      const body: Record<string, unknown> = { trustProfile: posture.profileId };

      if (selectedPosture === "Custom") {
        body.sovereignCap = settings.sovereignCap;
        body.sovereignCapWindowHours = settings.sovereignCapWindowHours;
        body.maxRiskFloor = settings.maxRiskFloor;
        body.blockThreshold = settings.blockThreshold;
        body.minConfidenceCeiling = settings.minConfidenceCeiling;
        body.policyOverrides = settings;
      }

      const res = await fetch(
        `${API_BASE}/registry/${encodeURIComponent(address.trim())}/policy`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
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
    const preset = p.id === "Custom"
      ? (selectedPosture === "ZeroTrust" ? PRESET_VALUES.ZeroTrust : PRESET_VALUES.CommunityTrust)
      : PRESET_VALUES[p.id] ?? PRESET_VALUES.ZeroTrust;
    setSelectedPosture(p.id);
    setSettings({ ...getInitialSettings(p.id), ...preset });
  };

  const setSetting = (key: string, value: number) => {
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

  const renderSettingRow = (s: PolicySettingDef, readOnly: boolean) => (
    <div key={s.key} className="flex items-center justify-between gap-4 py-2 border-b border-slate-700/50 last:border-0">
      <div className="flex items-center min-w-0">
        <span className="text-slate-300 text-sm">{s.label}</span>
        <InfoTooltip
          title={s.label}
          description={s.description}
          zeroTrust={s.zeroTrust}
          communityTrust={s.communityTrust}
          whereUsed={s.whereUsed}
        />
      </div>
      {readOnly ? (
        <span className="font-mono text-slate-200 text-sm">
          {s.unit === "$" && "$"}
          {settings[s.key]}
          {s.unit === "%" && "%"}
          {s.unit === "hrs" && " hrs"}
          {s.unit === "min" && " min"}
          {s.unit === "XRP" && " XRP"}
        </span>
      ) : (
        <input
          type="number"
          min={s.min}
          max={s.max}
          value={settings[s.key] ?? 0}
          onChange={(e) => setSetting(s.key, Math.min(s.max, Math.max(s.min, Number(e.target.value) || 0)))}
          className="w-24 bg-slate-700 text-slate-200 px-2 py-1 rounded text-sm border border-slate-600"
        />
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-slate-400 mb-1">Target Address (Registry Entry)</label>
        <input
          type="text"
          value={address}
          onChange={(e) => { setAddress(e.target.value); onAddressChange?.(e.target.value); }}
          placeholder="0x... or r..."
          className="w-full bg-slate-700 text-slate-200 px-4 py-2 rounded border border-slate-600 focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
        />
      </div>

      <div>
        <p className="text-sm font-bold text-slate-400 mb-3">Defense Posture</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
          {selectedPosture === "Custom" ? "Custom Thresholds" : "Current Settings"}
          {(selectedPosture === "ZeroTrust" || selectedPosture === "CommunityTrust") && (
            <span className="ml-2 text-xs font-normal text-slate-500">
              (from {selectedPosture === "ZeroTrust" ? "Zero-Trust" : "Community-Trust"} preset)
            </span>
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
              <div className="px-4 py-2 space-y-0">
                {group.settings.map((s) => renderSettingRow(s, selectedPosture !== "Custom"))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div>
        <button
          onClick={handleDeploy}
          disabled={deploying}
          className="w-full bg-red-600 hover:bg-red-500 disabled:bg-slate-600 disabled:cursor-not-allowed px-6 py-3 rounded font-bold text-white transition-all"
        >
          {deploying ? "Deploying…" : "Deploy Sovereign Law"}
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
