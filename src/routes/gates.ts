import { Hono } from "hono";

const REGISTRY_URL =
  process.env.GATES_REGISTRY_URL ??
  "https://raw.githubusercontent.com/genspec-dev/quality-gates/main/index.json";

export const gatesRouter = new Hono();

gatesRouter.get("/", async (c) => {
  try {
    const res = await fetch(REGISTRY_URL);
    if (!res.ok) return c.json({ error: "Registry unavailable" }, 502);
    const data = await res.json();
    return c.json(data);
  } catch {
    return c.json({ error: "Registry fetch failed" }, 502);
  }
});
