import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../src/app.js";

describe("GET /taxonomy", () => {
  beforeEach(() => {
    delete process.env.TAXONOMY_PATH;
  });

  it("returns 404 when taxonomy.json does not exist", async () => {
    process.env.TAXONOMY_PATH = "/nonexistent/path/taxonomy.json";
    const res = await app.request("/taxonomy");
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });

  it("GET /health returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("ok");
  });
});
