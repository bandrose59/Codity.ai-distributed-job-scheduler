import type { DashboardMetrics, JobSummary, QueueSummary, WorkerSummary } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("scheduler-token");
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.error?.message ?? "Request failed";
    const error = new Error(message) as Error & { code?: string; status?: number };
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as T;
}

export async function login(email: string, password: string) {
  return apiRequest<{ user: { id: string; name: string; email: string }; token: string }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function register(name: string, email: string, password: string) {
  return apiRequest<{ user: { id: string; name: string; email: string }; token: string }>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password })
  });
}

export async function getProjects() {
  return apiRequest<{ projects: Array<{ id: string; name: string; description?: string | null }> }>("/api/v1/projects");
}

export async function getOrganizations() {
  return apiRequest<{ organizations: Array<{ id: string; name: string }> }>("/api/v1/organizations");
}

export async function createProject(payload: { organizationId: string; name: string; description?: string }) {
  return apiRequest<{ project: { id: string; name: string } }>("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getJobs(query?: { queueId?: string; status?: string; type?: string; limit?: number; cursor?: string }) {
  const params = new URLSearchParams();
  if (query?.queueId) params.set("queueId", query.queueId);
  if (query?.status) params.set("status", query.status);
  if (query?.type) params.set("type", query.type);
  if (query?.limit) params.set("limit", String(query.limit));
  if (query?.cursor) params.set("cursor", query.cursor);
  return apiRequest<{ jobs: JobSummary[]; nextCursor?: string | null }>(`/api/v1/jobs?${params.toString()}`);
}

export async function getJobById(id: string) {
  return apiRequest<{ job: JobSummary }>(`/api/v1/jobs/${id}`);
}

export async function cancelJob(id: string) {
  return apiRequest<{ job: JobSummary }>(`/api/v1/jobs/${id}/cancel`, { method: "POST" });
}

export async function retryJob(id: string) {
  return apiRequest<{ job: JobSummary }>(`/api/v1/jobs/${id}/retry`, { method: "POST" });
}

export async function getWorkers() {
  return apiRequest<{ workers: WorkerSummary[] }>("/api/v1/workers");
}

export async function getQueues(projectId: string) {
  return apiRequest<{ queues: QueueSummary[] }>(`/api/v1/projects/${projectId}/queues`);
}

export async function createQueue(projectId: string, payload: { name: string; description?: string; priority: number; concurrencyLimit: number }) {
  return apiRequest<{ queue: QueueSummary }>(`/api/v1/projects/${projectId}/queues`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getQueueStats(queueId: string) {
  return apiRequest<{ stats: { queueId: string; jobs: Record<string, number>; deadLetterJobs: number } }>(`/api/v1/queues/${queueId}/stats`);
}

export async function setQueueStatus(queueId: string, status: "pause" | "resume") {
  return apiRequest<{ queue: QueueSummary }>(`/api/v1/queues/${queueId}/${status}`, { method: "POST" });
}

export async function archiveQueue(queueId: string) {
  return apiRequest<{ queue: QueueSummary }>(`/api/v1/queues/${queueId}`, { method: "DELETE" });
}

export async function getDeadLetters() {
  return apiRequest<{ deadLetters: Array<{ id: string; queueId: string; reason: string; attemptCount: number; createdAt: string; job: JobSummary }> }>("/api/v1/dlq?limit=50");
}

export async function retryDeadLetter(id: string) {
  return apiRequest<{ job: JobSummary }>(`/api/v1/dlq/${id}/retry`, { method: "POST" });
}

export async function createJob(payload: Record<string, unknown>) {
  return apiRequest<{ job: JobSummary | null; scheduledJob: Record<string, unknown> | null }>("/api/v1/jobs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function getDashboardOverview() {
  return apiRequest<{ metrics: DashboardMetrics }>("/api/v1/dashboard");
}

export async function getDashboardAlerts() {
  return apiRequest<{ alerts: Array<{ id: string; severity: "ERROR"; timestamp: string; source: string; message: string; relatedJobId: string }> }>("/api/v1/dashboard/alerts");
}

export async function getOperationalMetrics() {
  return apiRequest<{ generatedAt: string; process: { uptimeSeconds: number; heapUsedBytes: number; rssBytes: number; eventLoopDelayMs: number; eventLoopP99Ms: number }; http: { routes: Record<string, { requestsTotal: number; errorsTotal: number; errorRate: number; p50Ms: number; p95Ms: number; p99Ms: number }> } }>("/metrics");
}
