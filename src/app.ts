import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { gatesRouter } from "./routes/gates.js";
import { contributeRouter } from "./routes/contribute.js";
import { taxonomyRouter } from "./routes/taxonomy.js";
import { quarantineRouter } from "./routes/quarantine.js";
import { usersRouter } from "./routes/users.js";
import { billingRouter } from "./routes/billing.js";
import { countQuarantineEntries } from "./quarantine/service.js";
import { loadConfiguredApiKeys } from "./middleware/api-key.js";

const SERVER_VERSION = "0.2.0";

export const app = new Hono();

app.use("*", cors({ origin: ["https://genspec.dev", "https://forgecraft.tools", "https://jghiringhelli.github.io", "http://localhost:3000"] }));
app.use("*", logger());

app.get("/health", (c) =>
  c.json({
    status: "ok",
    version: SERVER_VERSION,
    timestamp: new Date().toISOString(),
    quarantineCount: countQuarantineEntries(),
    configuredKeyCount: loadConfiguredApiKeys().size,
  })
);

app.route("/gates", gatesRouter);
app.route("/contribute", contributeRouter);
app.route("/taxonomy", taxonomyRouter);
app.route("/quarantine", quarantineRouter);
app.route("/", usersRouter);
app.route("/billing", billingRouter);

export default app;
