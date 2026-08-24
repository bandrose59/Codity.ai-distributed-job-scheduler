import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "packages/database/prisma/schema.prisma",
  migrations: {
    path: "packages/database/prisma/migrations",
    seed: "pnpm --filter @job-scheduler/database seed"
  },
  datasource: {
    url: env("DATABASE_URL")
  }
});
