import type { Context, Next } from "hono";

/** Valid forgecraft API key format: fg_ prefix followed by exactly 32 alphanumeric characters */
const API_KEY_PATTERN = /^fg_[a-zA-Z0-9]{32}$/;

/** Monthly submission limit per key on the free tier */
const FREE_TIER_MONTHLY_LIMIT = 20;

/**
 * DX workshop key: higher hourly limit to support workshop participants.
 * Separate limit from the monthly free tier.
 */
const WORKSHOP_HOURLY_LIMIT = 50;

/**
 * In-memory rate limit counter keyed by `{apiKey}:{year}-{month}`.
 * Resets on server restart — sufficient for MVP.
 */
const rateLimitMap = new Map<string, number>();

/**
 * Hourly bucket for workshop keys, keyed by `{apiKey}:{year}-{month}-{day}-{hour}`.
 */
const hourlyRateLimitMap = new Map<string, number>();

/**
 * Parse FORGECRAFT_API_KEYS env var (comma-separated) and FORGECRAFT_API_KEY
 * (single key, legacy) into a Set of valid keys.
 * If neither is set, format-only validation is used (MVP mode).
 *
 * @returns Set of configured API keys, or empty Set if not configured
 */
export function loadConfiguredApiKeys(): ReadonlySet<string> {
  const multi = process.env.FORGECRAFT_API_KEYS;
  const single = process.env.FORGECRAFT_API_KEY ?? process.env.API_KEY;
  const keys = new Set<string>();
  if (multi) {
    for (const k of multi.split(",")) {
      const trimmed = k.trim();
      if (trimmed) keys.add(trimmed);
    }
  }
  if (single) keys.add(single);
  return keys;
}

/**
 * Check if a key is a designated workshop key (prefixed `fg_ws_` or listed in
 * FORGECRAFT_WORKSHOP_KEYS env var).
 */
function isWorkshopKey(apiKey: string, configuredKeys: ReadonlySet<string>): boolean {
  const workshopKeys = process.env.FORGECRAFT_WORKSHOP_KEYS;
  if (workshopKeys) {
    const set = new Set(workshopKeys.split(",").map((k) => k.trim()));
    if (set.has(apiKey)) return true;
  }
  return apiKey.startsWith("fg_ws");
}

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
 * Returns the composite rate-limit key for the current hour.
 * @param apiKey - The validated API key
 */
function hourBucketKey(apiKey: string): string {
  const now = new Date();
  return `${apiKey}:${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
}

/**
 * Hono middleware that validates the X-Forgecraft-Key request header.
 *
 * Key validation:
 * - If FORGECRAFT_API_KEYS / FORGECRAFT_API_KEY env vars are set: membership check.
 * - Otherwise: format-only validation (/^fg_[a-zA-Z0-9]{32}$/) — MVP/open mode.
 *
 * Rate limits:
 * - Standard keys: 20 submissions/month (free tier).
 * - Workshop keys (FORGECRAFT_WORKSHOP_KEYS or fg_ws prefix): 50 submissions/hour.
 *
 * @param c - Hono context
 * @param next - Next middleware in chain
 */
export async function apiKeyMiddleware(c: Context, next: Next): Promise<Response | void> {
  const apiKey = c.req.header("X-Forgecraft-Key");

  if (!apiKey) {
    return c.json({ error: "Missing API key. Get yours at genspec.dev" }, 401);
  }

  const configuredKeys = loadConfiguredApiKeys();

  // If explicit keys configured: membership check. Otherwise: format check.
  if (configuredKeys.size > 0) {
    if (!configuredKeys.has(apiKey)) {
      return c.json({ error: "Invalid API key. Get yours at genspec.dev" }, 401);
    }
  } else if (!API_KEY_PATTERN.test(apiKey)) {
    return c.json({ error: "Invalid API key format. Get yours at genspec.dev" }, 401);
  }

  // Rate limiting: workshop keys use hourly bucket, standard keys use monthly
  if (isWorkshopKey(apiKey, configuredKeys)) {
    const bucket = hourBucketKey(apiKey);
    const count = hourlyRateLimitMap.get(bucket) ?? 0;
    if (count >= WORKSHOP_HOURLY_LIMIT) {
      return c.json({ error: `Workshop rate limit reached (${WORKSHOP_HOURLY_LIMIT}/hour).` }, 429);
    }
    hourlyRateLimitMap.set(bucket, count + 1);
  } else {
    const bucket = monthBucketKey(apiKey);
    const count = rateLimitMap.get(bucket) ?? 0;
    if (count >= FREE_TIER_MONTHLY_LIMIT) {
      return c.json(
        { error: "Monthly limit reached (20/month on free tier). Upgrade at genspec.dev" },
        429,
      );
    }
    rateLimitMap.set(bucket, count + 1);
  }

  await next();
}
