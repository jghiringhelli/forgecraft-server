import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../src/app.js";

describe("POST /contribute/gate", () => {
  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  const validGate = {
    id: "test-gate",
    title: "Test Gate Title",
    description: "Test gate description for testing purposes.",
    category: "security",
    gsProperty: "defended",
    phase: "development" as const,
    hook: "pre-commit",
    check: "Run the static analyzer and check for errors.",
    passCriterion: "Zero HIGH/CRITICAL findings.",
    tags: ["UNIVERSAL"],
    evidence:
      "This gate would have caught a real SQL injection bug in a production API that allowed unauthenticated data access.",
  };

  it("accepts valid anonymous gate and returns 202 when no GITHUB_TOKEN", async () => {
    const res = await app.request("/contribute/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gate: validGate, mode: "anonymous" }),
    });
    expect(res.status).toBe(202);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("pending");
    expect(body.gateId).toBe("test-gate");
    expect(body.mode).toBe("anonymous");
  });

  it("accepts valid attributed gate and returns 202 when no GITHUB_TOKEN", async () => {
    const res = await app.request("/contribute/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gate: validGate,
        mode: "attributed",
        attribution: { github: "testuser", projectType: "fintech simulation" },
      }),
    });
    expect(res.status).toBe(202);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("pending");
    expect(body.mode).toBe("attributed");
  });

  it("rejects gate with missing evidence field with 400", async () => {
    const { evidence: _evidence, ...gateWithoutEvidence } = validGate;
    const res = await app.request("/contribute/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gate: gateWithoutEvidence, mode: "anonymous" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects gate with evidence shorter than 20 characters with 400", async () => {
    const res = await app.request("/contribute/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gate: { ...validGate, evidence: "Too short." },
        mode: "anonymous",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /health returns 200 with status ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
  });
});
