import type { ReactNode } from "react";

import { cn } from "../lib/utils";

const toneClasses = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  error: "border-red-500/30 bg-red-500/10 text-red-200",
  neutral: "border-slate-600 bg-slate-700/70 text-slate-200",
  info: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
} as const;

export function StatusBadge({
  children,
  tone = "neutral",
  className
}: {
  children: ReactNode;
  tone?: keyof typeof toneClasses;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]",
        toneClasses[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
