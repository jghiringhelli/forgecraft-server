import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const GateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  gsProperty: z.string().min(1),
  phase: z.enum(["development", "pre-release", "rc", "deployment", "continuous"]),
  hook: z.string().min(1),
  check: z.string().min(10),
  passCriterion: z.string().min(1),
  tags: z.array(z.string()).optional(),
  evidence: z.string().min(20, "Evidence must describe a real bug this gate would catch"),
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
type GatePayload = z.infer<typeof GateSchema>;
type AttributionPayload = z.infer<typeof AttributionSchema>;

export const contributeRouter = new Hono();

contributeRouter.post(
  "/gate",
  zValidator("json", ContributeGateSchema),
  async (c) => {
    const { gate, mode, attribution } = c.req.valid("json") as ContributeGatePayload;

    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      console.log("GITHUB_TOKEN not configured — gate queued locally:", gate.id);
      return c.json(
        {
          status: "pending",
          message: "Gate queued. Configure GITHUB_TOKEN to submit to GitHub automatically.",
          gateId: gate.id,
          mode,
        },
        202
      );
    }

    try {
      const issueBody = buildIssueBody(gate, mode, attribution);
      const response = await fetch(
        "https://api.github.com/repos/genspec-dev/quality-gates/issues",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            title: `[Gate Proposal] ${gate.title}`,
            body: issueBody,
            labels: [
              "gate-proposal",
              `tag:${(gate.tags?.[0] ?? "universal").toLowerCase()}`,
              "status:pending-review",
            ],
          }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        return c.json({ error: "GitHub issue creation failed", detail: err }, 502);
      }

      const issue = (await response.json()) as { html_url: string; number: number };
      return c.json(
        {
          status: "submitted",
          issueUrl: issue.html_url,
          issueNumber: issue.number,
          gateId: gate.id,
          mode,
          message:
            mode === "attributed"
              ? "Gate submitted. If approved, you will earn one month of ForgeCraft Pro."
              : "Gate submitted anonymously. Thank you for contributing.",
        },
        201
      );
    } catch {
      return c.json({ error: "Failed to create GitHub issue" }, 500);
    }
  }
);

/**
 * Builds the GitHub issue body for a gate proposal.
 * @param gate - The gate definition
 * @param mode - Contribution mode: "anonymous" or "attributed"
 * @param attribution - Optional attribution details
 * @returns Formatted markdown issue body
 */
function buildIssueBody(
  gate: GatePayload,
  mode: string,
  attribution?: AttributionPayload
): string {
  const contrib =
    mode === "attributed" && attribution?.github
      ? `**Contributor**: @${attribution.github}`
      : `**Contributor**: anonymous`;
  const projType = attribution?.projectType
    ? `**Project type**: ${attribution.projectType}`
    : "";

  return `## Gate Proposal

${contrib}
${projType}

---

### Gate Definition

**ID**: \`${gate.id}\`
**Title**: ${gate.title}
**Category**: ${gate.category}
**GS Property**: ${gate.gsProperty}
**Phase**: ${gate.phase}
**Hook**: ${gate.hook}
**Tags**: ${(gate.tags ?? ["UNIVERSAL"]).join(", ")}

### Description
${gate.description}

### Check
\`\`\`
${gate.check}
\`\`\`

### Pass Criterion
${gate.passCriterion}

### Evidence
> ${gate.evidence}

---

*Submitted via ForgeCraft contribute-gate (mode: ${mode})*
`;
}
