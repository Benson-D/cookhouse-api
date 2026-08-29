import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./router.js";
import { createContext } from "./context.js";

const app = express();

// Needed for correct X-Forwarded-* handling once this runs behind a real
// host's proxy/load balancer.
app.set("trust proxy", 1);

app.use(helmet());
app.use(morgan("tiny"));

// Comma-separated, so a deployed frontend origin and a local dev origin can
// both be trusted by the same running instance at once.
const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim());

app.use(cors({ origin: corsOrigins }));

// Images never pass through this body — they go straight to S3 via a
// presigned PUT (see lib/storage.ts) — so even the largest legitimate
// mutation (a recipe with many ingredients and steps) stays well under this.
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
    maxBodySize: MAX_REQUEST_BODY_BYTES,
  })
);

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`cookhouse-api listening on http://localhost:${port}`);
});
