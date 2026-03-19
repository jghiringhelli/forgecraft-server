import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { apiKeyMiddleware } from "../middleware/api-key.js";
import { writeGateToQuarantine, openGitHubIssue } from "../quarantine/service.js";

const GateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  domain: z.string().min(1),
  gsProperty: z.string().min(1),
  phase: z.enum(["development", "pre-release", "rc", "deployment", "continuous"]),
  check: z.string().min(10),
  passCriterion: z.string().min(1),
  evidence: z.string().min(20, "Evidence must describe a real bug this gate would catch"),
  hook: z.string().optional(),
  tags: z.array(z.string()).optional(),
  priority: z.string().optional(),
  language: z.string().optional(),
  failureMessage: z.string().optional(),
  fixHint: z.string().optional(),
  likelihood: z.string().optional(),
  impact: z.string().optional(),
  confidence: z.string().optional(),
});

const AttributionSchema = z.object({
  github: z.string().optional(),
  projectType: z.string().optional(),
});

const ContributeGateSchema = z.object({
  gate: GateSchema,
  mode: z.enum(["anonymous", "attributed"]),
  attribution: AttributionSchema.optional(),
});

type ContributeGatePayload = z.infer<typeof ContributeGateSchema>;

export const contributeRouter = new Hono();

contributeRouter.post(
  "/gate",
  apiKeyMiddleware,
  zValidator("json", ContributeGateSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "Validation failed", details: result.error.errors }, 422);
    }
  }),
  async (c) => {
    const { gate, mode, attribution } = c.req.valid("json") as ContributeGatePayload;

    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return c.json(
        { error: "Gate submission unavailable: server not configured for issue tracking" },
        503
      );
    }

    // Write local audit cache first (best-effort, non-blocking)
    const entry = writeGateToQuarantine(gate, mode, attribution);

    // GitHub Issue is the primary durable record -- required, not best-effort
    let issueUrl: string;
    try {
      issueUrl = await openGitHubIssue(entry, githubToken);
    } catch (err) {
      console.error("GitHub issue creation failed:", err);
      return c.json(
        { error: "Gate submission failed: could not create tracking issue. Try again later." },
        503
      );
    }

    return c.json(
      {
        status: "quarantined",
        message: "Gate received and under review.",
        gateId: gate.id,
        issueUrl,
        mode,
      },
      201
    );
  }
);
