import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrate needs a direct (unpooled) connection, not the pooled one the app uses at runtime.
    url: env("DIRECT_URL"),
  },
});
