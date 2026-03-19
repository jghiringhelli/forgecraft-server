import type { Context, Next } from "hono";

/** Valid forgecraft API key format: fg_ prefix followed by exactly 32 alphanumeric characters */
const API_KEY_PATTERN = /^fg_[a-zA-Z0-9]{32}$/;

/** Monthly submission limit per key on the free tier */
const FREE_TIER_MONTHLY_LIMIT = 20;

/**
 * In-memory rate limit counter keyed by `{apiKey}:{year}-{month}`.
 * Resets on server restart — sufficient for MVP.
 * TODO: Replace with Redis or Postgres for persistent rate limiting in production.
 */
const rateLimitMap = new Map<string, number>();

/**
 * Returns the composite rate-limit key for the current calendar month.
 * @param apiKey - The validated API key
 * @returns A string combining the key with the current UTC year and month
 */
function monthBucketKey(apiKey: string): string {
  const now = new Date();
  return `${apiKey}:${now.getUTCFullYear()}-${now.getUTCMonth()}`;
}

/**
 * Hono middleware that validates the X-Forgecraft-Key request header.
 *
 * Free tier rules:
 * - Key must match /^fg_[a-zA-Z0-9]{32}$/ (format-only validation).
 * - Maximum 20 gate submissions per key per calendar month.
 *
 * TODO: Add database lookup to validate keys against issued keys once
 *       the auth service is available.
 *
 * @param c - Hono context
 * @param next - Next middleware in chain
 */
export async function apiKeyMiddleware(c: Context, next: Next): Promise<Response | void> {
  const apiKey = c.req.header("X-Forgecraft-Key");

  if (!apiKey || !API_KEY_PATTERN.test(apiKey)) {
    return c.json({ error: "Invalid API key. Get yours at genspec.dev" }, 401);
  }

  const bucket = monthBucketKey(apiKey);
  const currentCount = rateLimitMap.get(bucket) ?? 0;

  if (currentCount >= FREE_TIER_MONTHLY_LIMIT) {
    return c.json(
      { error: "Monthly limit reached (20/month on free tier). Upgrade at genspec.dev" },
      429
    );
  }

  rateLimitMap.set(bucket, currentCount + 1);
  await next();
}
