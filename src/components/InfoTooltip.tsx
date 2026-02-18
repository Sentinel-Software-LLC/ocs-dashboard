"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface InfoTooltipProps {
  title: string;
  description: string;
  zeroTrust: string;
  communityTrust: string;
  whereUsed?: string;
}

export default function InfoTooltip({
  title,
  description,
  zeroTrust,
  communityTrust,
  whereUsed,
}: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !(e.target as Element).closest("[data-infotooltip-portal]")
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && buttonRef.current && typeof document !== "undefined") {
      const rect = buttonRef.current.getBoundingClientRect();
      const tooltipWidth = 288;
      const tooltipHeight = 140;
      const padding = 8;
      let left = rect.left;
      if (left + tooltipWidth + padding > window.innerWidth) left = window.innerWidth - tooltipWidth - padding;
      if (left < padding) left = padding;
      let top = rect.bottom + 4;
      if (top + tooltipHeight + padding > window.innerHeight) top = rect.top - tooltipHeight - 4;
      if (top < padding) top = padding;
      setPosition({ top, left });
    }
  }, [open]);

  const tooltipContent = open && (
    <div
      data-infotooltip-portal
      className="fixed z-[9999] w-72 p-3 bg-slate-800 border border-slate-600 rounded-lg shadow-xl text-left"
      style={{ top: position.top, left: position.left }}
    >
      <p className="text-xs font-bold text-slate-200 mb-1">{title}</p>
      <p className="text-xs text-slate-400 mb-2">{description}</p>
      <div className="space-y-1 text-[11px]">
        <p>
          <span className="text-red-400 font-medium">Zero-Trust:</span>{" "}
          <span className="text-slate-300">{zeroTrust}</span>
        </p>
        <p>
          <span className="text-amber-400 font-medium">Community-Trust:</span>{" "}
          <span className="text-slate-300">{communityTrust}</span>
        </p>
        {whereUsed && (
          <p className="text-slate-500 italic mt-1">Used in: {whereUsed}</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        className="ml-1.5 w-4 h-4 rounded-full bg-slate-600 hover:bg-slate-500 text-slate-300 text-[10px] font-bold flex items-center justify-center cursor-help"
        aria-label="More information"
      >
        i
      </button>
      {typeof document !== "undefined" && tooltipContent && createPortal(tooltipContent, document.body)}
    </div>
  );
}
