import { prisma } from "@job-scheduler/database";
import { OrganizationRole } from "@prisma/client";

import { ApiError, notFound } from "./common/errors.js";

export async function requireOrganizationMember(userId: string, organizationId: string) {
  const membership = await prisma.organizationMember.findUnique({
    where: { userId_organizationId: { userId, organizationId } }
  });
  if (!membership) {
    throw notFound("ORGANIZATION_NOT_FOUND", "Organization not found");
  }
  return membership;
}

export async function requireOrganizationRole(
  userId: string,
  organizationId: string,
  roles: OrganizationRole[]
) {
  const membership = await requireOrganizationMember(userId, organizationId);
  if (!roles.includes(membership.role)) {
    throw new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action");
  }
  return membership;
}

export async function requireProjectAccess(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      organization: { members: { some: { userId } } }
    }
  });
  if (!project) {
    throw notFound("PROJECT_NOT_FOUND", "Project not found");
  }
  return project;
}

export async function requireProjectRole(userId: string, projectId: string) {
  const project = await requireProjectAccess(userId, projectId);
  await requireOrganizationRole(userId, project.organizationId, [
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN
  ]);
  return project;
}
