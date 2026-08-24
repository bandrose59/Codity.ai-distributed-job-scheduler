import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, MemoryRouter, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  Server
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AppShell } from "./components/AppShell";
import { JobCreateForm } from "./components/JobCreateForm";
import { MetricStat } from "./components/MetricStat";
import { PageHeader } from "./components/PageHeader";
import { StatusBadge } from "./components/StatusBadge";
import { archiveQueue, cancelJob, createJob, createProject, createQueue, getDashboardAlerts, getDashboardOverview, getDeadLetters, getJobById, getJobs, getOperationalMetrics, getOrganizations, getProjects, getQueues, getQueueStats, getWorkers, login, register, retryDeadLetter, retryJob, setQueueStatus } from "./api/client";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

function DashboardPage() {
  const dashboardQuery = useQuery({ queryKey: ["dashboard-overview"], queryFn: getDashboardOverview, refetchInterval: 15_000, enabled: Boolean(localStorage.getItem("scheduler-token")) });
  const jobsQuery = useQuery({ queryKey: ["jobs", "recent"], queryFn: () => getJobs({ limit: 10 }), refetchInterval: 10_000, enabled: Boolean(localStorage.getItem("scheduler-token")) });
  const metrics = dashboardQuery.data?.metrics;
  const jobs = jobsQuery.data?.jobs ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Scheduler health and recent execution throughput across the cluster." />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricStat label="Active workers" value={String(metrics?.activeWorkers ?? "—")} tone="success" icon={<Server className="h-3.5 w-3.5" />} />
        <MetricStat label="Running jobs" value={String(metrics?.runningJobs ?? "—")} tone="warning" icon={<Activity className="h-3.5 w-3.5" />} />
        <MetricStat label="Queued jobs" value={String(metrics?.queuedJobs ?? "—")} tone="info" icon={<Clock3 className="h-3.5 w-3.5" />} />
        <MetricStat label="Failed / 24h" value={String(metrics?.failedLast24h ?? "—")} tone="error" icon={<AlertTriangle className="h-3.5 w-3.5" />} />
        <MetricStat label="DLQ jobs" value={String(metrics?.dlqJobs ?? "—")} tone="neutral" icon={<DatabaseZap className="h-3.5 w-3.5" />} />
        <MetricStat label="Success rate" value={metrics?.successRate == null ? "—" : `${metrics.successRate}%`} tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.7fr_0.9fr]">
        <div className="rounded border border-slate-800 bg-slate-900/80 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Throughput</div>
              <h2 className="mt-1 text-lg font-medium text-slate-50">Jobs completed vs failed</h2>
            </div>
            <StatusBadge tone="success">Healthy</StatusBadge>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics?.trend ?? []} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="completedFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="failedFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#fbbf24" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: "#020817", borderColor: "#1e293b", color: "#e2e8f0" }} />
                <Area type="monotone" dataKey="completed" stroke="#34d399" fill="url(#completedFill)" strokeWidth={2} />
                <Area type="monotone" dataKey="failed" stroke="#fbbf24" fill="url(#failedFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded border border-slate-800 bg-slate-900/80 p-4">
          <div className="mb-4 text-[11px] uppercase tracking-[0.16em] text-slate-400">Cluster summary</div>
          <div className="space-y-4">
            {[
              ["Overview refresh", dashboardQuery.isFetching ? "UPDATING" : dashboardQuery.isError ? "UNAVAILABLE" : "LIVE"],
              ["Jobs refresh", jobsQuery.isFetching ? "UPDATING" : jobsQuery.isError ? "UNAVAILABLE" : "LIVE"],
              ["Last update", metrics ? new Date().toLocaleTimeString() : "—"]
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/60 px-3 py-2">
                <span className="text-sm text-slate-400">{label}</span>
                <span className="font-mono text-sm text-slate-100">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded border border-slate-800 bg-slate-900/80 p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Recent job runs</div>
            <h2 className="mt-1 text-lg font-medium text-slate-50">Live execution activity</h2>
          </div>
          <button className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200">View all jobs</button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
              <tr className="border-b border-slate-800">
                <th className="px-3 py-2">Job</th>
                <th className="px-3 py-2">Queue</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Worker</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Attempt</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-slate-800/80 hover:bg-slate-800/30">
                  <td className="px-3 py-2 font-mono text-slate-100"><Link className="text-cyan-300 hover:text-cyan-200" to={`/jobs/${job.id}`}>{job.id}</Link></td>
                  <td className="px-3 py-2 text-slate-300">{job.queue?.name ?? job.queueId}</td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={job.status === "RUNNING" ? "warning" : job.status === "FAILED" ? "error" : job.status === "COMPLETED" ? "success" : "neutral"}>
                      {job.status}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-300">{job.executions?.[0]?.workerId ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-300">{job.startedAt ? new Date(job.startedAt).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2 font-mono text-slate-300">{job.executions?.[0]?.durationMs ? `${job.executions[0].durationMs}ms` : "—"}</td>
                  <td className="px-3 py-2 text-slate-300">{job.attemptCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function JobsPage() {
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: getProjects });
  const organizationsQuery = useQuery({ queryKey: ["organizations"], queryFn: getOrganizations });
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [queueName, setQueueName] = useState("");
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showQueueForm, setShowQueueForm] = useState(false);
  const selectedProjectId = projectId || projectsQuery.data?.projects[0]?.id || "";
  const queuesQuery = useQuery({ queryKey: ["queues", selectedProjectId], queryFn: () => getQueues(selectedProjectId), enabled: Boolean(selectedProjectId) });
  const projectMutation = useMutation({
    mutationFn: () => createProject({ organizationId: organizationsQuery.data?.organizations[0]?.id ?? "", name: projectName }),
    onSuccess: async (result) => {
      setProjectName("");
      setShowProjectForm(false);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setProjectId(result.project.id);
    }
  });
  const queueMutation = useMutation({
    mutationFn: () => createQueue(selectedProjectId, { name: queueName, priority: 0, concurrencyLimit: 1 }),
    onSuccess: async () => {
      setQueueName("");
      setShowQueueForm(false);
      await queryClient.invalidateQueries({ queryKey: ["queues", selectedProjectId] });
    }
  });
  const createMutation = useMutation({
    mutationFn: createJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] })
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        subtitle="Search, filter, and manage distributed job execution."
        actions={<div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setShowProjectForm((value) => !value)} className="rounded border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200">{showProjectForm ? "Close project" : "New project"}</button><button type="button" disabled={!selectedProjectId} onClick={() => setShowQueueForm((value) => !value)} className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50">{showQueueForm ? "Close queue" : "New queue"}</button></div>}
      />
      {(showProjectForm || showQueueForm) && <section className="grid gap-4 md:grid-cols-2">
        {showProjectForm && <form onSubmit={(event) => { event.preventDefault(); projectMutation.mutate(); }} className="rounded border border-cyan-500/20 bg-cyan-500/[0.04] p-4"><p className="text-[11px] uppercase tracking-[0.16em] text-cyan-300">Create project</p><p className="mt-1 text-xs text-slate-400">Projects organize queues and job traffic.</p><input required value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Project name" className="mt-4 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none" /><button disabled={projectMutation.isPending || !organizationsQuery.data?.organizations.length} className="mt-3 rounded bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{projectMutation.isPending ? "Creating..." : "Create project"}</button>{projectMutation.isError && <p className="mt-2 text-xs text-red-300">{projectMutation.error.message}</p>}</form>}
        {showQueueForm && <form onSubmit={(event) => { event.preventDefault(); queueMutation.mutate(); }} className="rounded border border-emerald-500/20 bg-emerald-500/[0.04] p-4"><p className="text-[11px] uppercase tracking-[0.16em] text-emerald-300">Create queue</p><p className="mt-1 text-xs text-slate-400">Selected project: {projectsQuery.data?.projects.find((project) => project.id === selectedProjectId)?.name ?? "—"}</p><input required value={queueName} onChange={(event) => setQueueName(event.target.value)} placeholder="Queue name" className="mt-4 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none" /><button disabled={queueMutation.isPending} className="mt-3 rounded bg-emerald-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{queueMutation.isPending ? "Creating..." : "Create queue"}</button>{queueMutation.isError && <p className="mt-2 text-xs text-red-300">{queueMutation.error.message}</p>}</form>}
      </section>}
      {projectsQuery.data && projectsQuery.data.projects.length > 0 && <div className="flex items-center gap-3"><label className="text-xs uppercase tracking-[0.16em] text-slate-500" htmlFor="project-select">Project</label><select id="project-select" aria-label="Project" value={selectedProjectId} onChange={(event) => setProjectId(event.target.value)} className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100">{projectsQuery.data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>}
      <div className="rounded border border-slate-800 bg-slate-900/80 p-4">
        <JobCreateForm
          queues={queuesQuery.data?.queues ?? []}
          submitting={createMutation.isPending}
          onSubmit={(payload) => createMutation.mutate(payload)}
        />
        {queuesQuery.data?.queues.length === 0 && <p className="mt-4 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">No queues are available for this project. Seed local development data or create a queue through the API before submitting a job.</p>}
        {createMutation.isSuccess && <p className="mt-4 text-sm text-emerald-300">Job accepted by the scheduler.</p>}
        {createMutation.isError && <p className="mt-4 text-sm text-red-300">{createMutation.error.message}</p>}
      </div>
    </div>
  );
}

function WorkersPage() {
  const workersQuery = useQuery({ queryKey: ["workers"], queryFn: getWorkers, refetchInterval: 10_000, enabled: Boolean(localStorage.getItem("scheduler-token")) });
  const workers = workersQuery.data?.workers ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="Workers" subtitle="Active execution nodes and heartbeat health." />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {workers.map((worker) => (
          <div key={worker.id} className="rounded border border-slate-800 bg-slate-900/80 p-4">
            <div className="flex items-center justify-between"><span className="font-mono text-slate-100">{worker.workerIdentifier}</span><StatusBadge tone={worker.status === "ACTIVE" ? "success" : worker.status === "DEAD" ? "error" : "warning"}>{worker.status}</StatusBadge></div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><span className="text-slate-400">Host</span><span className="text-right text-slate-200">{worker.hostname ?? "—"}</span><span className="text-slate-400">Heartbeat</span><span className="text-right text-slate-200">{worker.lastHeartbeatAt ? new Date(worker.lastHeartbeatAt).toLocaleString() : "—"}</span></div>
          </div>
        ))}
      </section>
    </div>
  );
}

function JobDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const jobQuery = useQuery({ queryKey: ["job", id], queryFn: () => getJobById(id), enabled: Boolean(id), refetchInterval: 5_000 });
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const operation = useMutation({ mutationFn: (action: "retry" | "cancel") => action === "retry" ? retryJob(id) : cancelJob(id), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["job", id] }); await queryClient.invalidateQueries({ queryKey: ["jobs"] }); } });
  const job = jobQuery.data?.job;
  const execution = job?.executions?.find((item) => item.id === selectedExecutionId) ?? job?.executions?.at(-1);
  if (jobQuery.isLoading) return <PageHeader title="Loading job" subtitle="Fetching execution state..." />;
  if (!job) return <PageHeader title="Job unavailable" subtitle={jobQuery.error instanceof Error ? jobQuery.error.message : "The job could not be loaded."} />;
  return <div className="space-y-6"><PageHeader title="Job detail" subtitle={<span className="font-mono text-xs">{job.id}</span>} actions={<button onClick={() => navigate("/jobs")} className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200">Back to jobs</button>} /><section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[["Status", <StatusBadge tone={job.status === "COMPLETED" ? "success" : job.status === "FAILED" ? "error" : "warning"}>{job.status}</StatusBadge>], ["Type", job.type], ["Queue", job.queue?.name ?? job.queueId], ["Priority", job.priority], ["Attempts", `${job.attemptCount} / ${job.maxAttempts}`], ["Worker", job.executions?.at(-1)?.workerId ?? "—"], ["Created", new Date(job.createdAt).toLocaleString()], ["Updated", new Date(job.updatedAt).toLocaleString()]].map(([label, value]) => <div key={String(label)} className="rounded border border-slate-800 bg-slate-900/80 p-4"><div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</div><div className="mt-2 text-sm text-slate-100">{value}</div></div>)}</section>{job.lastError && <div className="rounded border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200"><span className="font-semibold">Last error:</span> {job.lastError}</div>}<div className="flex flex-wrap gap-2"><button disabled={operation.isPending || job.status !== "FAILED"} onClick={() => operation.mutate("retry")} className="rounded bg-amber-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">Retry</button><button disabled={operation.isPending || !["QUEUED", "SCHEDULED"].includes(job.status)} onClick={() => operation.mutate("cancel")} className="rounded border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm font-semibold text-red-200 disabled:cursor-not-allowed disabled:opacity-40">Cancel</button>{operation.isError && <span className="self-center text-sm text-red-300">{operation.error.message}</span>}</div><section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]"><div className="rounded border border-slate-800 bg-slate-900/80 p-4"><div className="mb-4 text-[11px] uppercase tracking-[0.16em] text-slate-400">Execution history</div><div className="space-y-2">{(job.executions ?? []).map((item) => <button key={item.id} onClick={() => setSelectedExecutionId(item.id)} className={`w-full rounded border px-3 py-3 text-left ${execution?.id === item.id ? "border-cyan-500/50 bg-cyan-500/10" : "border-slate-800 bg-slate-950/50"}`}><div className="flex items-center justify-between"><span className="text-sm text-slate-100">Attempt {item.attempt}</span><StatusBadge tone={item.status === "COMPLETED" ? "success" : item.status === "FAILED" || item.status === "ABANDONED" ? "error" : "warning"}>{item.status}</StatusBadge></div><div className="mt-2 text-xs text-slate-500">{new Date(item.startedAt).toLocaleString()} · {item.durationMs == null ? "—" : `${item.durationMs}ms`}</div></button>)}{job.executions?.length === 0 && <p className="text-sm text-slate-500">No executions yet. The worker will appear here after claiming the job.</p>}</div></div><div className="space-y-6"><div className="rounded border border-slate-800 bg-slate-900/80 p-4"><div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-slate-400">Execution output</div><pre className="max-h-64 overflow-auto rounded bg-slate-950 p-4 text-xs leading-6 text-emerald-200">{JSON.stringify(execution?.output ?? { status: "waiting", message: "No output yet" }, null, 2)}</pre>{execution?.stderr && <p className="mt-3 text-xs text-red-300">stderr: {execution.stderr}</p>}{execution?.error && <p className="mt-3 text-sm text-red-300">{execution.error}</p>}</div><div className="rounded border border-slate-800 bg-[#020617] p-4"><div className="mb-3 flex items-center justify-between"><div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Execution logs</div><button type="button" onClick={() => navigator.clipboard?.writeText((execution?.logs ?? []).map((log) => `${log.createdAt} ${log.level} ${log.message}`).join("\n"))} className="text-xs text-cyan-300 hover:text-cyan-200">Copy logs</button></div><div className="max-h-72 overflow-auto font-mono text-xs leading-6">{(execution?.logs ?? []).map((log) => <div key={log.id}><span className="text-slate-600">{new Date(log.createdAt).toLocaleTimeString()}</span> <span className={log.level === "ERROR" ? "text-red-300" : "text-cyan-300"}>[{log.level}]</span> <span className="text-slate-300">{log.message}</span></div>)}{execution?.logs?.length === 0 && <span className="text-slate-600">No logs recorded for this attempt.</span>}</div></div></div></section></div>;
}

function QueuesPage() {
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: getProjects });
  const projectId = projectsQuery.data?.projects[0]?.id ?? "";
  const queuesQuery = useQuery({ queryKey: ["queues", projectId], queryFn: () => getQueues(projectId), enabled: Boolean(projectId), refetchInterval: 5_000 });
  const [busyId, setBusyId] = useState<string | null>(null);
  async function operate(queueId: string, action: "pause" | "resume" | "archive") {
    setBusyId(queueId);
    try { if (action === "archive") await archiveQueue(queueId); else await setQueueStatus(queueId, action); await queryClient.invalidateQueries({ queryKey: ["queues", projectId] }); } finally { setBusyId(null); }
  }
  return <div className="space-y-6"><PageHeader title="Queues" subtitle="Control throughput, concurrency, and retry pressure." /><div className="grid gap-4 lg:grid-cols-2">{(queuesQuery.data?.queues ?? []).map((queue) => <QueueCard key={queue.id} queue={queue} busy={busyId === queue.id} onOperate={operate} />)}</div>{queuesQuery.data?.queues.length === 0 && <p className="text-sm text-slate-500">No queues found for the selected project.</p>}</div>;
}

function QueueCard({ queue, busy, onOperate }: { queue: Awaited<ReturnType<typeof getQueues>>["queues"][number]; busy: boolean; onOperate: (id: string, action: "pause" | "resume" | "archive") => void }) {
  const statsQuery = useQuery({ queryKey: ["queue-stats", queue.id], queryFn: () => getQueueStats(queue.id), refetchInterval: 5_000 });
  const jobs = statsQuery.data?.stats.jobs ?? {};
  return <div className="rounded border border-slate-800 bg-slate-900/80 p-4"><div className="flex items-start justify-between gap-4"><div><h2 className="font-mono text-lg text-slate-100">{queue.name}</h2><p className="mt-1 text-xs text-slate-500">Priority {queue.priority} · Concurrency {queue.concurrencyLimit}</p></div><StatusBadge tone={queue.status === "ACTIVE" ? "success" : "warning"}>{queue.status}</StatusBadge></div><div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded bg-slate-950 p-2"><b className="block text-lg text-cyan-200">{jobs.QUEUED ?? 0}</b>queued</div><div className="rounded bg-slate-950 p-2"><b className="block text-lg text-amber-200">{(jobs.RUNNING ?? 0) + (jobs.CLAIMED ?? 0)}</b>active</div><div className="rounded bg-slate-950 p-2"><b className="block text-lg text-red-200">{statsQuery.data?.stats.deadLetterJobs ?? 0}</b>DLQ</div></div><div className="mt-4 flex gap-2"><button disabled={busy} onClick={() => onOperate(queue.id, queue.status === "PAUSED" ? "resume" : "pause")} className="rounded border border-slate-700 px-3 py-2 text-xs text-slate-200 disabled:opacity-50">{queue.status === "PAUSED" ? "Resume" : "Pause"}</button><button disabled={busy} onClick={() => onOperate(queue.id, "archive")} className="rounded border border-red-500/30 px-3 py-2 text-xs text-red-200 disabled:opacity-50">Archive</button></div></div>;
}

function DlqPage() {
  const queryClient = useQueryClient();
  const dlqQuery = useQuery({ queryKey: ["dlq"], queryFn: getDeadLetters, refetchInterval: 10_000 });
  const retryMutation = useMutation({ mutationFn: retryDeadLetter, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dlq"] }) });
  return <div className="space-y-6"><PageHeader title="Dead-letter queue" subtitle="Inspect exhausted jobs and retry them through the backend." /><div className="space-y-3">{(dlqQuery.data?.deadLetters ?? []).map((item) => <div key={item.id} className="flex flex-col gap-3 rounded border border-red-500/20 bg-red-500/[0.04] p-4 md:flex-row md:items-center md:justify-between"><div><div className="font-mono text-sm text-slate-100">{item.job.id}</div><div className="mt-1 text-sm text-red-200">{item.reason}</div><div className="mt-1 text-xs text-slate-500">Queue {item.queueId} · {item.attemptCount} attempts · {new Date(item.createdAt).toLocaleString()}</div></div><div className="flex gap-2"><Link to={`/jobs/${item.job.id}`} className="rounded border border-slate-700 px-3 py-2 text-xs text-slate-200">Inspect</Link><button disabled={retryMutation.isPending} onClick={() => retryMutation.mutate(item.id)} className="rounded bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50">Retry</button></div></div>)}{dlqQuery.data?.deadLetters.length === 0 && <p className="text-sm text-slate-500">No dead-letter jobs.</p>}</div></div>;
}

function OperationsPage() {
  const metricsQuery = useQuery({ queryKey: ["operational-metrics"], queryFn: getOperationalMetrics, refetchInterval: 5_000 });
  const routes = Object.entries(metricsQuery.data?.http.routes ?? {});
  const requests = routes.reduce((sum, [, metric]) => sum + metric.requestsTotal, 0);
  const errors = routes.reduce((sum, [, metric]) => sum + metric.errorsTotal, 0);
  const p95 = routes.length ? Math.max(...routes.map(([, metric]) => metric.p95Ms)) : 0;
  return <div className="space-y-6"><PageHeader title="Operations" subtitle="Measured API and process health from this service instance." /><section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><MetricStat label="Requests" value={String(requests)} tone="info" /><MetricStat label="Error rate" value={requests ? `${((errors / requests) * 100).toFixed(2)}%` : "0%"} tone={errors ? "warning" : "success"} /><MetricStat label="Max route p95" value={`${p95}ms`} tone="neutral" /><MetricStat label="Event loop p99" value={`${(metricsQuery.data?.process.eventLoopP99Ms ?? 0).toFixed(2)}ms`} tone="success" /></section><div className="rounded border border-slate-800 bg-slate-900/80 p-4"><div className="mb-4 text-[11px] uppercase tracking-[0.16em] text-slate-400">HTTP routes</div><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="text-xs uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-3 py-2">Route</th><th className="px-3 py-2">Requests</th><th className="px-3 py-2">Errors</th><th className="px-3 py-2">p50</th><th className="px-3 py-2">p95</th><th className="px-3 py-2">p99</th></tr></thead><tbody>{routes.map(([route, metric]) => <tr key={route} className="border-t border-slate-800"><td className="px-3 py-2 font-mono text-slate-300">{route}</td><td className="px-3 py-2 text-slate-300">{metric.requestsTotal}</td><td className="px-3 py-2 text-slate-300">{metric.errorsTotal}</td><td className="px-3 py-2 text-slate-300">{metric.p50Ms}ms</td><td className="px-3 py-2 text-slate-300">{metric.p95Ms}ms</td><td className="px-3 py-2 text-slate-300">{metric.p99Ms}ms</td></tr>)}</tbody></table></div></div></div>;
}

function TimelinePage() {
  const dashboardQuery = useQuery({ queryKey: ["dashboard-overview", "timeline"], queryFn: getDashboardOverview, refetchInterval: 15_000, enabled: Boolean(localStorage.getItem("scheduler-token")) });
  return <div className="space-y-6"><PageHeader title="Timeline" subtitle="Execution throughput grouped into four-hour windows." /><div className="rounded border border-slate-800 bg-slate-900/80 p-4"><div className="space-y-3">{(dashboardQuery.data?.metrics.trend ?? []).map((point) => <div key={point.time} className="grid grid-cols-[60px_1fr_80px] items-center gap-3 text-sm"><span className="font-mono text-slate-400">{point.time}</span><div className="h-2 overflow-hidden rounded bg-slate-800"><div className="h-full bg-emerald-400" style={{ width: `${Math.min(point.completed * 5, 100)}%` }} /></div><span className="text-right text-slate-300">{point.completed} done / {point.failed} failed</span></div>)}</div></div></div>;
}

function AlertsPage() {
  const alertsQuery = useQuery({ queryKey: ["dashboard-alerts"], queryFn: getDashboardAlerts, refetchInterval: 15_000, enabled: Boolean(localStorage.getItem("scheduler-token")) });
  return <div className="space-y-6"><PageHeader title="Alerts" subtitle="Recent authenticated job failures from the last 24 hours." /><div className="space-y-3">{(alertsQuery.data?.alerts ?? []).map((alert) => <div key={alert.id} className="flex items-start gap-3 rounded border border-red-500/20 bg-red-500/5 p-4"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" /><div><div className="flex flex-wrap gap-3"><StatusBadge tone="error">{alert.severity}</StatusBadge><span className="font-mono text-xs text-slate-400">{new Date(alert.timestamp).toLocaleString()}</span></div><p className="mt-2 text-sm text-slate-200">{alert.message}</p><p className="mt-1 font-mono text-xs text-slate-500">{alert.source} / {alert.relatedJobId}</p></div></div>)}</div></div>;
}

function AuthPage({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = mode === "login" ? await login(email, password) : await register(name, email, password);
      localStorage.setItem("scheduler-token", result.token);
      onLogin();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to sign in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#071014] text-slate-100">
      <div className="mx-auto grid min-h-screen max-w-[1500px] lg:grid-cols-[1.15fr_0.85fr]">
        <section className="relative hidden overflow-hidden border-r border-white/10 px-10 py-10 lg:flex lg:flex-col lg:justify-between xl:px-16">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(110,231,183,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(110,231,183,0.05)_1px,transparent_1px)] bg-[size:48px_48px]" />
          <div className="absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-emerald-400/10 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl border border-emerald-300/30 bg-emerald-300/10 font-mono text-sm font-bold text-emerald-200">DJ</div><div><p className="text-[10px] uppercase tracking-[0.28em] text-emerald-200/70">Distributed systems</p><p className="font-mono text-sm text-slate-200">job_scheduler / control plane</p></div></div>
            <div className="max-w-xl pb-10 pt-28 xl:pt-36"><p className="mb-5 font-mono text-xs uppercase tracking-[0.25em] text-emerald-300">Observe. Dispatch. Recover.</p><h2 className="text-5xl mt-8 font-semibold leading-[1.02] tracking-[-0.04em] text-white xl:text-7xl">The calm center of your job fleet.</h2><p className="mt-30 mb-60 max-w-lg text-base leading-8  text-slate-400">One operational surface for queues, workers, retries, and execution health. Built for the moments when every job matters.</p></div>
          </div>
          <div className="relative grid max-w-xl grid-cols-3 gap-3">
            {[['01', 'observe the fleet'], ['02', 'dispatch with intent'], ['03', 'recover with context']].map(([value, label]) => <div key={label} className="rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur"><div className="font-mono text-xl text-emerald-200">{value}</div><div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-slate-500">{label}</div></div>)}
          </div>
        </section>
        <section className="flex items-center justify-center px-5 py-8 sm:px-10">
          <div className="w-full max-w-md">
            <div className="mb-8 flex items-center justify-between lg:hidden"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-300/30 bg-emerald-300/10 font-mono text-sm font-bold text-emerald-200">DJ</div><span className="font-mono text-sm text-slate-200">job_scheduler</span></div><span className="text-[10px] uppercase tracking-[0.2em] text-emerald-300">Control plane</span></div>
            <div className="mb-8"><p className="text-xs uppercase tracking-[0.22em] text-emerald-300">{mode === "login" ? "Welcome back" : "Create workspace access"}</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">{mode === "login" ? "Sign in to your fleet" : "Start operating clearly"}</h1><p className="mt-3 text-sm leading-6 text-slate-400">{mode === "login" ? "Your queues and workers are waiting." : "Create an account to provision your scheduler workspace."}</p></div>
            <form onSubmit={submit} className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-7">
              {mode === "register" && <label className="block space-y-2 text-sm text-slate-300"><span>Name</span><input required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="w-full rounded-lg border border-white/10 bg-black/20 px-3.5 py-3 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-300/60 focus:ring-2 focus:ring-emerald-300/10" /></label>}
              <label className="block space-y-2 text-sm text-slate-300"><span>Email address</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="w-full rounded-lg border border-white/10 bg-black/20 px-3.5 py-3 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-300/60 focus:ring-2 focus:ring-emerald-300/10" /></label>
              <label className="block space-y-2 text-sm text-slate-300"><span>Password</span><input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} className="w-full rounded-lg border border-white/10 bg-black/20 px-3.5 py-3 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-300/60 focus:ring-2 focus:ring-emerald-300/10" /></label>
              {error && <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p>}
              <button disabled={submitting} className="group flex w-full items-center justify-between rounded-lg bg-emerald-300 px-4 py-3 text-sm font-semibold text-[#071014] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"><span>{submitting ? "Connecting..." : mode === "login" ? "Enter control plane" : "Create account"}</span><ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></button>
            </form>
            <div className="mt-6 flex items-center justify-between text-sm"><span className="text-slate-500">{mode === "login" ? "New to the control plane?" : "Already have access?"}</span><button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} className="font-medium text-emerald-300 transition hover:text-emerald-200">{mode === "login" ? "Create an account" : "Sign in instead"}</button></div>
            <p className="mt-12 text-center text-[11px] uppercase tracking-[0.16em] text-slate-600">Encrypted session · tenant isolated · operator ready</p>
          </div>
        </section>
      </div>
    </main>
  );
}

export function App() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(localStorage.getItem("scheduler-token")));
  if (!authenticated) return <AuthPage onLogin={() => setAuthenticated(true)} />;

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AppShell onLogout={() => { localStorage.removeItem("scheduler-token"); setAuthenticated(false); }}>
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/:id" element={<JobDetailPage />} />
            <Route path="/queues" element={<QueuesPage />} />
            <Route path="/dlq" element={<DlqPage />} />
            <Route path="/operations" element={<OperationsPage />} />
            <Route path="/workers" element={<WorkersPage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/alerts" element={<AlertsPage />} />
          </Routes>
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
