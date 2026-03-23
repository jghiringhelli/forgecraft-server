import { Hono } from "hono";
import { clerkMiddleware, getAuth } from "@clerk/hono";
import {
  upsertUser,
  claimProjectSlot,
  getProjectUsage,
  regenerateApiKey,
  ProjectLimitError,
} from "../modules/users/users.service.js";

export const usersRouter = new Hono();

usersRouter.use("*", clerkMiddleware());

/**
 * GET /me — returns the authenticated user's profile, API key, and usage.
 * Upserts the user on first call (auto-provisions API key).
 */
usersRouter.get("/me", async (c) => {
  const auth = getAuth(c);
  if (!auth?.userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const email = auth.sessionClaims?.email as string | undefined;
  if (!email) {
    return c.json({ error: "Email not found in token claims" }, 400);
  }

  const user = await upsertUser(auth.userId, email);
  const usage = await getProjectUsage(user.id);

  return c.json({
    id: user.id,
    email: user.email,
    tier: user.tier,
    apiKey: user.apiKey?.key ?? null,
    usage,
  });
});

/**
 * POST /me/keys/regenerate — revokes current key and issues a new one.
 */
usersRouter.post("/me/keys/regenerate", async (c) => {
  const auth = getAuth(c);
  if (!auth?.userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const email = auth.sessionClaims?.email as string | undefined;
  if (!email) {
    return c.json({ error: "Email not found in token claims" }, 400);
  }

  const user = await upsertUser(auth.userId, email);
  const newKey = await regenerateApiKey(user.id);

  return c.json({ apiKey: newKey });
});

/**
 * POST /me/projects/claim — claims one project setup slot for the current month.
 * Returns 429 if the tier limit is reached.
 */
usersRouter.post("/me/projects/claim", async (c) => {
  const auth = getAuth(c);
  if (!auth?.userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const email = auth.sessionClaims?.email as string | undefined;
  if (!email) {
    return c.json({ error: "Email not found in token claims" }, 400);
  }

  const user = await upsertUser(auth.userId, email);

  try {
    const usage = await claimProjectSlot(user.id);
    return c.json({ claimed: true, count: usage.count });
  } catch (err) {
    if (err instanceof ProjectLimitError) {
      return c.json(
        {
          error: err.message,
          tier: err.tier,
          limit: err.limit,
          upgradeUrl: "https://forgecraft.tools/#pricing",
        },
        429,
      );
    }
    throw err;
  }
});
