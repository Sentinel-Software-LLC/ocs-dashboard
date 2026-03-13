"use client";

import { useState, useEffect } from "react";
import { getBuildId } from "@/lib/api";

/**
 * D1: Tamper-evident UI — Displays build ID (checksum) so users can verify
 * they're running an approved build. Subtle footer banner.
 */
export default function TamperEvidentBanner() {
  const [buildId, setBuildId] = useState<string | null>(null);

  useEffect(() => {
    getBuildId().then(setBuildId);
  }, []);

  if (!buildId) return null;

  return (
    <footer
      className="fixed bottom-0 left-0 right-0 py-1 px-3 text-center text-xs text-slate-500 bg-slate-900/80 border-t border-slate-800 font-mono"
      title="D1: Build checksum — verify against known-good build"
    >
      Build: <span className="text-slate-400">{buildId}</span>
    </footer>
  );
}
