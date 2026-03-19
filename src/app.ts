import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { gatesRouter } from "./routes/gates.js";
import { contributeRouter } from "./routes/contribute.js";
import { taxonomyRouter } from "./routes/taxonomy.js";
import { quarantineRouter } from "./routes/quarantine.js";
import { countQuarantineEntries } from "./quarantine/service.js";

export const app = new Hono();

app.use("*", cors({ origin: ["https://genspec.dev", "https://jghiringhelli.github.io", "http://localhost:3000"] }));
app.use("*", logger());

app.get("/health", (c) =>
  c.json({
    status: "ok",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
    quarantineCount: countQuarantineEntries(),
  })
);

app.route("/gates", gatesRouter);
app.route("/contribute", contributeRouter);
app.route("/taxonomy", taxonomyRouter);
app.route("/quarantine", quarantineRouter);

export default app;
