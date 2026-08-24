import { useMemo, useState } from "react";

import type { QueueSummary } from "../types";

export function JobCreateForm({
  queues,
  onSubmit,
  initialQueueId,
  submitting = false
}: {
  queues: QueueSummary[];
  onSubmit: (payload: Record<string, unknown>) => void;
  initialQueueId?: string;
  submitting?: boolean;
}) {
  const [type, setType] = useState("IMMEDIATE");
  const [inputMode, setInputMode] = useState<"payload" | "script">("payload");
  const [queueId, setQueueId] = useState(initialQueueId ?? queues[0]?.id ?? "");
  const [payload, setPayload] = useState("{\n  \"recipient\": \"ops@example.com\"\n}");
  const [script, setScript] = useState<{ name: string; content: string } | null>(null);
  const [priority, setPriority] = useState(10);
  const [scheduledAt, setScheduledAt] = useState("");
  const [cronExpression, setCronExpression] = useState("*/5 * * * *");
  const [timezone, setTimezone] = useState("UTC");

  const showScheduleFields = useMemo(
    () => type === "DELAYED" || type === "SCHEDULED" || type === "CRON",
    [type]
  );

  const showCronFields = type === "CRON";

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const parsedPayload = (() => {
          if (inputMode === "script") {
            return { script: script ?? { name: "inline-script", content: payload } };
          }
          try {
            return JSON.parse(payload);
          } catch {
            return { raw: payload };
          }
        })();

        const next = {
          queueId,
          type,
          payload: parsedPayload,
          priority,
          ...(showScheduleFields && scheduledAt ? { scheduledAt } : {}),
          ...(showCronFields ? { cronExpression, timezone } : {})
        };
        onSubmit(next);
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm text-slate-300">
          <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Queue</span>
          <select
            aria-label="Queue"
            value={queueId}
            onChange={(event) => setQueueId(event.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-cyan-500 focus:outline-none"
          >
            {queues.length === 0 && <option value="">No queues available</option>}
            {queues.map((queue) => (
              <option key={queue.id} value={queue.id}>
                {queue.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm text-slate-300">
          <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Job type</span>
          <select
            aria-label="Job type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-cyan-500 focus:outline-none"
          >
            <option value="IMMEDIATE">IMMEDIATE</option>
            <option value="DELAYED">DELAYED</option>
            <option value="SCHEDULED">SCHEDULED</option>
            <option value="CRON">CRON</option>
            <option value="BATCH">BATCH</option>
          </select>
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <button type="button" onClick={() => setInputMode("payload")} className={`rounded px-3 py-1.5 text-xs font-semibold ${inputMode === "payload" ? "bg-cyan-500/15 text-cyan-200" : "text-slate-400 hover:text-slate-200"}`}>JSON payload</button>
          <button type="button" onClick={() => setInputMode("script")} className={`rounded px-3 py-1.5 text-xs font-semibold ${inputMode === "script" ? "bg-emerald-500/15 text-emerald-200" : "text-slate-400 hover:text-slate-200"}`}>Upload script</button>
        </div>
        {inputMode === "payload" ? (
          <label className="block space-y-2 text-sm text-slate-300">
            <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Payload</span>
            <textarea value={payload} onChange={(event) => setPayload(event.target.value)} rows={8} className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-cyan-500 focus:outline-none" />
          </label>
        ) : (
          <label className="block space-y-3 rounded border border-dashed border-emerald-500/30 bg-emerald-500/[0.04] p-4 text-sm text-slate-300">
            <span className="block text-[11px] uppercase tracking-[0.16em] text-emerald-300">Script attachment</span>
            <input aria-label="Upload script" type="file" accept=".js,.ts,.py,.sh,.sql,.txt" onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setScript({ name: file.name, content: String(reader.result ?? "") });
              reader.readAsText(file);
            }} className="block w-full text-sm text-slate-400 file:mr-3 file:rounded file:border-0 file:bg-emerald-300 file:px-3 file:py-2 file:font-semibold file:text-[#071014]" />
            <span className="block text-xs text-slate-500">{script ? `${script.name} loaded and will be stored in the job payload.` : "JavaScript, TypeScript, Python, shell, SQL, or text files up to the API payload limit."}</span>
            <span className="block text-xs text-amber-300/80">Uploaded scripts are stored as job data. The current worker does not execute arbitrary code.</span>
          </label>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm text-slate-300">
          <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Priority</span>
          <input
            type="number"
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value))}
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-cyan-500 focus:outline-none"
          />
        </label>

        {showScheduleFields && (
          <label className="space-y-2 text-sm text-slate-300">
            <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Scheduled time</span>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-cyan-500 focus:outline-none"
            />
          </label>
        )}
      </div>

      {showCronFields && (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-300">
            <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Cron expression</span>
            <input
              aria-label="Cron expression"
              value={cronExpression}
              onChange={(event) => setCronExpression(event.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
            />
          </label>

          <label className="space-y-2 text-sm text-slate-300">
            <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Timezone</span>
            <input
              aria-label="Timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-cyan-500 focus:outline-none"
            />
          </label>
        </div>
      )}

      <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
        <button type="button" className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200">
          Cancel
        </button>
        <button type="submit" disabled={submitting || !queueId} className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50">
          {submitting ? "Creating..." : "Create job"}
        </button>
      </div>
    </form>
  );
}
