import { PrismaClient, RetryStrategy, OrganizationRole } from "@prisma/client";

const prisma = new PrismaClient();

const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "owner@example.test";
const ownerName = process.env.SEED_OWNER_NAME ?? "Development Owner";
const ownerPasswordHash =
  process.env.SEED_OWNER_PASSWORD_HASH ?? "development-only-password-hash-not-for-production";
const organizationId = "00000000-0000-0000-0000-000000000201";
const projectId = "00000000-0000-0000-0000-000000000301";

async function main() {
  const fixedRetryPolicy = await prisma.retryPolicy.upsert({
    where: { id: "00000000-0000-0000-0000-000000000101" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000101",
      strategy: RetryStrategy.FIXED,
      maxAttempts: 3,
      initialDelayMs: 5_000,
      maxDelayMs: 30_000
    }
  });

  const exponentialRetryPolicy = await prisma.retryPolicy.upsert({
    where: { id: "00000000-0000-0000-0000-000000000102" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000102",
      strategy: RetryStrategy.EXPONENTIAL,
      maxAttempts: 5,
      initialDelayMs: 1_000,
      maxDelayMs: 60_000
    }
  });

  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {
      name: ownerName
    },
    create: {
      email: ownerEmail,
      name: ownerName,
      passwordHash: ownerPasswordHash
    }
  });

  const organization = await prisma.organization.upsert({
    where: { id: organizationId },
    update: {
      name: "Development Organization"
    },
    create: {
      id: organizationId,
      name: "Development Organization"
    }
  });

  await prisma.organizationMember.upsert({
    where: {
      userId_organizationId: {
        userId: owner.id,
        organizationId: organization.id
      }
    },
    update: {
      role: OrganizationRole.OWNER
    },
    create: {
      userId: owner.id,
      organizationId: organization.id,
      role: OrganizationRole.OWNER
    }
  });

  const project = await prisma.project.upsert({
    where: { id: projectId },
    update: {
      name: "Development Project",
      description: "Seed project for local development",
      deletedAt: null
    },
    create: {
      id: projectId,
      organizationId: organization.id,
      name: "Development Project",
      description: "Seed project for local development"
    }
  });

  await prisma.queue.upsert({
    where: {
      projectId_name: {
        projectId: project.id,
        name: "email"
      }
    },
    update: {
      description: "Email delivery queue",
      priority: 10,
      concurrencyLimit: 5,
      retryPolicyId: fixedRetryPolicy.id,
      deletedAt: null
    },
    create: {
      projectId: project.id,
      name: "email",
      description: "Email delivery queue",
      priority: 10,
      concurrencyLimit: 5,
      retryPolicyId: fixedRetryPolicy.id
    }
  });

  await prisma.queue.upsert({
    where: {
      projectId_name: {
        projectId: project.id,
        name: "reports"
      }
    },
    update: {
      description: "Report generation queue",
      priority: 5,
      concurrencyLimit: 2,
      retryPolicyId: exponentialRetryPolicy.id,
      deletedAt: null
    },
    create: {
      projectId: project.id,
      name: "reports",
      description: "Report generation queue",
      priority: 5,
      concurrencyLimit: 2,
      retryPolicyId: exponentialRetryPolicy.id
    }
  });

  const queueCount = await prisma.queue.count({
    where: {
      project: {
        organizationId: organization.id
      }
    }
  });

  console.info({
    ownerEmail,
    organization: organization.name,
    queueCount,
    retryPolicies: [fixedRetryPolicy.strategy, exponentialRetryPolicy.strategy]
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
