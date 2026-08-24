import { JobStatus } from "@prisma/client";

const transitions: Record<JobStatus, readonly JobStatus[]> = {
  SCHEDULED: ["CANCELLED"],
  QUEUED: ["CLAIMED", "CANCELLED"],
  CLAIMED: ["RUNNING"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  RETRYING: [],
  CANCELLED: []
};

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!(transitions[from] ?? []).includes(to)) {
    throw new Error(`Invalid job state transition: ${from} -> ${to}`);
  }
}
