import { Hono } from "hono";
import { listQuarantineIssues } from "../quarantine/service.js";

export const quarantineRouter = new Hono();

/**
 * GET /quarantine -- admin endpoint listing all open quarantine issues from GitHub.
 * Requires the X-Admin-Key header matching the ADMIN_KEY environment variable.
 * Uses GITHUB_TOKEN to query the quality-gates repo for open `quarantine` issues.
 */
quarantineRouter.get("/", async (c) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return c.json({ error: "Admin endpoint not configured on this instance" }, 503);
  }

  const providedKey = c.req.header("X-Admin-Key");
  if (!providedKey || providedKey !== adminKey) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    return c.json({ error: "GITHUB_TOKEN not configured -- cannot query quarantine issues" }, 503);
  }

  try {
    const issues = await listQuarantineIssues(githubToken);
    return c.json({ count: issues.length, issues });
  } catch (err) {
    console.error("Failed to list quarantine issues:", err);
    return c.json({ error: "Failed to fetch quarantine issues from GitHub" }, 502);
  }
});
