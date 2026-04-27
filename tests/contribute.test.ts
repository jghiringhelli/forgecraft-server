import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { app } from "../src/app.js";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync, existsSync } from "fs";

const TEST_QUARANTINE_DIR = join(tmpdir(), `forgecraft-test-${process.pid}`);

/** Generates a valid fg_ API key for test use */
function makeApiKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return "fg_" + Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/** Stubs global fetch to return a fake GitHub issue response */
function stubGitHubFetch(fetchSpy: MockInstance, issueNumber = 1): void {
  fetchSpy.mockResolvedValue({
    ok: true,
    json: async () => ({
      number: issueNumber,
      html_url: `https://github.com/jghiringhelli/quality-gates/issues/${issueNumber}`,
      title: "[Gate Proposal] Test Gate Title",
      created_at: new Date().toISOString(),
    }),
    text: async () => "",
  } as unknown as Response);
}

const validGate = {
  id: "test-gate",
  title: "Test Gate Title",
  description: "Test gate description for testing purposes.",
  domain: "security",
  gsProperty: "defended",
  phase: "development" as const,
  check: "Run the static analyzer and check for errors.",
  passCriterion: "Zero HIGH/CRITICAL findings.",
  tags: ["UNIVERSAL"],
  evidence:
    "This gate would have caught a real SQL injection bug in a production API that allowed unauthenticated data access.",
};

describe("POST /contribute/gate", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    process.env.GITHUB_TOKEN = "ghp_test_token";
    process.env.QUARANTINE_DIR = TEST_QUARANTINE_DIR;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    stubGitHubFetch(fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GITHUB_TOKEN;
    if (existsSync(TEST_QUARANTINE_DIR)) {
      rmSync(TEST_QUARANTINE_DIR, { recursive: true, force: true });
    }
  });

  it("rejects request with no API key with 401", async () => {
    const res = await app.request("/contribute/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gate: validGate, mode: "anonymous" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
    expect(body.error as string).toContain("forgecraft.tools");
  });

  it("rejects request with malformed API key with 401", async () => {
    const res = await app.request("/contribute/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forgecraft-Key": "bad-key" },
      body: JSON.stringify({ gate: validGate, mode: "anonymous" }),
    });
    expect(res.status).toBe(401);
  });

  it("accepts valid anonymous gate and returns 201 quarantined", async () => {
    const res = await app.request("/contribute/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forgecraft-Key": makeApiKey() },
      body: JSON.stringify({ gate: validGate, mode: "anonymous" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("quarantined");
    expect(body.gateId).toBe("test-gate");
    expect(body.mode).toBe("anonymous");
    expect(typeof body.issueUrl).toBe("string");
    expect(body.issueUrl as string).toContain("github.com");
  });

  it("accepts valid attributed gate and returns 201 quarantined", async () => {
    const res = await app.request("/contribute/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forgecraft-Key": makeApiKey() },
      body: JSON.stringify({
        gate: validGate,
        mode: "attributed",
        attribution: { github: "testuser", projectType: "fintech simulation" },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("quarantined");
    expect(body.mode).toBe("attributed");
  });

  it("rejects gate with missing evidence field with 422", async () => {
    const { evidence: _evidence, ...gateWithoutEvidence } = validGate;
    const res = await app.request("/contribute/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forgecraft-Key": makeApiKey() },
      body: JSON.stringify({ gate: gateWithoutEvidence, mode: "anonymous" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("Validation failed");
  });

  it("rejects gate with evidence shorter than 20 characters with 422", async () => {
    const res = await app.request("/contribute/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forgecraft-Key": makeApiKey() },
      body: JSON.stringify({
        gate: { ...validGate, evidence: "Too short." },
        mode: "anonymous",
      }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 429 after exceeding the 20/month rate limit", async () => {
    const key = makeApiKey();
    const headers = { "Content-Type": "application/json", "X-Forgecraft-Key": key };
    const payload = JSON.stringify({ gate: validGate, mode: "anonymous" });

    // Submit 20 times — all should succeed
    for (let i = 0; i < 20; i++) {
      const res = await app.request("/contribute/gate", { method: "POST", headers, body: payload });
      expect(res.status).toBe(201);
    }

    // 21st submission should be rate-limited
    const res = await app.request("/contribute/gate", { method: "POST", headers, body: payload });
    expect(res.status).toBe(429);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error as string).toContain("Monthly limit");
  });
});

describe("GET /quarantine", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    process.env.QUARANTINE_DIR = TEST_QUARANTINE_DIR;
    delete process.env.ADMIN_KEY;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    // Return empty issues list for quarantine list endpoint
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => [],
      text: async () => "",
    } as unknown as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(TEST_QUARANTINE_DIR)) {
      rmSync(TEST_QUARANTINE_DIR, { recursive: true, force: true });
    }
  });

  it("returns 503 when ADMIN_KEY is not configured", async () => {
    const res = await app.request("/quarantine");
    expect(res.status).toBe(503);
  });

  it("returns 401 when X-Admin-Key header is missing", async () => {
    process.env.ADMIN_KEY = "secret-admin-key";
    const res = await app.request("/quarantine");
    expect(res.status).toBe(401);
  });

  it("returns 401 when X-Admin-Key is wrong", async () => {
    process.env.ADMIN_KEY = "secret-admin-key";
    const res = await app.request("/quarantine", {
      headers: { "X-Admin-Key": "wrong-key" },
    });
    expect(res.status).toBe(401);
  });

  it("returns gate list when correct admin key provided", async () => {
    process.env.ADMIN_KEY = "secret-admin-key";
    process.env.GITHUB_TOKEN = "ghp_test_token";
    const res = await app.request("/quarantine", {
      headers: { "X-Admin-Key": "secret-admin-key" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.count).toBe("number");
    expect(Array.isArray(body.issues)).toBe(true);
  });
});

describe("GET /health", () => {
  beforeEach(() => {
    process.env.QUARANTINE_DIR = TEST_QUARANTINE_DIR;
  });

  afterEach(() => {
    if (existsSync(TEST_QUARANTINE_DIR)) {
      rmSync(TEST_QUARANTINE_DIR, { recursive: true, force: true });
    }
  });

  it("returns 200 with status ok and quarantineCount", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.2.0");
    expect(typeof body.quarantineCount).toBe("number");
  });
});
