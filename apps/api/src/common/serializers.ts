import type { Organization, Project, User, Worker } from "@prisma/client";

export function serializeUser(user: Pick<User, "id" | "name" | "email" | "createdAt">) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString()
  };
}

export function serializeOrganization(
  organization: Pick<Organization, "id" | "name" | "createdAt" | "updatedAt">
) {
  return {
    id: organization.id,
    name: organization.name,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString()
  };
}

export function serializeProject(
  project: Pick<
    Project,
    "id" | "organizationId" | "name" | "description" | "createdAt" | "updatedAt"
  >
) {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString()
  };
}

export function serializeWorker(
  worker: Pick<
    Worker,
    | "id"
    | "workerIdentifier"
    | "hostname"
    | "processId"
    | "status"
    | "lastHeartbeatAt"
    | "startedAt"
    | "stoppedAt"
    | "createdAt"
    | "updatedAt"
  >
) {
  return {
    id: worker.id,
    workerIdentifier: worker.workerIdentifier,
    hostname: worker.hostname,
    processId: worker.processId,
    status: worker.status,
    lastHeartbeatAt: worker.lastHeartbeatAt?.toISOString() ?? null,
    startedAt: worker.startedAt.toISOString(),
    stoppedAt: worker.stoppedAt?.toISOString() ?? null,
    createdAt: worker.createdAt.toISOString(),
    updatedAt: worker.updatedAt.toISOString()
  };
}
