import { env } from "@job-scheduler/config";

import { buildServer } from "./server.js";

async function main() {
  const app = buildServer();

  try {
    await app.listen({
      host: "0.0.0.0",
      port: env.API_PORT
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

await main();
