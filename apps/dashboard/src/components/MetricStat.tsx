import type { ReactNode } from "react";

import { cn } from "../lib/utils";

export function MetricStat({
  label,
  value,
  change,
  tone = "neutral",
  icon
}: {
  label: string;
  value: string;
  change?: string;
  tone?: "success" | "warning" | "error" | "neutral" | "info";
  icon?: ReactNode;
}) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/80 p-4 shadow-[0_0_0_1px_rgba(15,23,42,0.8)]">
      <div className="mb-3 flex items-center justify-between gap-3 text-slate-400">
        <span className="text-[11px] uppercase tracking-[0.16em]">{label}</span>
        {icon && <span className={cn(
          "rounded border p-1.5",
          tone === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
          tone === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-300",
          tone === "error" && "border-red-500/30 bg-red-500/10 text-red-300",
          tone === "info" && "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
          tone === "neutral" && "border-slate-700 bg-slate-800 text-slate-300"
        )}>{icon}</span>}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="font-mono text-2xl font-semibold tracking-tight text-slate-50 tabular-nums">{value}</div>
        {change && <div className="text-[11px] text-slate-400">{change}</div>}
      </div>
    </div>
  );
}
