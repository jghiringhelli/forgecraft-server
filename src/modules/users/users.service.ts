import { randomBytes } from "crypto";
import type { Tier } from "@prisma/client";
import { prisma } from "../../db/client.js";

/** Project setup limits per tier per calendar month. */
export const TIER_LIMITS: Record<Tier, number> = {
  FREE: 2,
  PRO: 20,
  TEAMS: Infinity,
};

/**
 * Returns the current UTC month as an ISO year-month string e.g. "2026-03".
 */
function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Generates a new API key in the format fg_[32 alphanumeric chars].
 */
function generateApiKey(): string {
  return `fg_${randomBytes(24).toString("base64url").slice(0, 32)}`;
}

/**
 * Creates or retrieves a user from Clerk identity data.
 * Auto-generates an API key on first creation.
 *
 * @param clerkId - Clerk user ID
 * @param email - User's primary email
 * @returns The user record including their api key
 */
export async function upsertUser(clerkId: string, email: string) {
  const existing = await prisma.user.findUnique({
    where: { clerkId },
    include: { apiKey: true },
  });
  if (existing) return existing;

  return prisma.user.create({
    data: {
      clerkId,
      email,
      apiKey: {
        create: { key: generateApiKey() },
      },
    },
    include: { apiKey: true },
  });
}

/**
 * Looks up a user by their API key.
 *
 * @param key - The fg_ prefixed API key from the request header
 * @returns The user with tier info, or null if not found / revoked
 */
export async function getUserByApiKey(key: string) {
  const apiKey = await prisma.apiKey.findUnique({
    where: { key },
    include: { user: true },
  });
  if (!apiKey || apiKey.revokedAt) return null;
  return apiKey.user;
}

/**
 * Claims one project setup slot for the user in the current month.
 * Throws if the user has reached their tier limit.
 *
 * @param userId - The user's database ID
 * @returns Updated usage record
 */
export async function claimProjectSlot(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const month = currentMonth();
  const limit = TIER_LIMITS[user.tier];

  const usage = await prisma.projectUsage.upsert({
    where: { userId_month: { userId, month } },
    create: { userId, month, count: 0 },
    update: {},
  });

  if (usage.count >= limit) {
    throw new ProjectLimitError(user.tier, limit, month);
  }

  return prisma.projectUsage.update({
    where: { userId_month: { userId, month } },
    data: { count: { increment: 1 } },
  });
}

/**
 * Returns current month's usage count for a user.
 *
 * @param userId - The user's database ID
 */
export async function getProjectUsage(userId: string) {
  const month = currentMonth();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const usage = await prisma.projectUsage.findUnique({
    where: { userId_month: { userId, month } },
  });
  return {
    used: usage?.count ?? 0,
    limit: TIER_LIMITS[user.tier],
    month,
    tier: user.tier,
  };
}

/**
 * Regenerates the API key for a user, revoking the old one.
 *
 * @param userId - The user's database ID
 * @returns New API key string
 */
export async function regenerateApiKey(userId: string): Promise<string> {
  const newKey = generateApiKey();
  await prisma.apiKey.update({
    where: { userId },
    data: { key: newKey, revokedAt: null },
  });
  return newKey;
}

/**
 * Updates a user's tier (called from Stripe webhook).
 *
 * @param stripeCustomerId - Stripe customer ID
 * @param tier - New tier
 * @param stripeSubscriptionId - Stripe subscription ID
 */
export async function updateUserTier(
  stripeCustomerId: string,
  tier: Tier,
  stripeSubscriptionId: string,
) {
  return prisma.user.update({
    where: { stripeCustomerId },
    data: { tier, stripeSubscriptionId },
  });
}

export class ProjectLimitError extends Error {
  readonly tier: Tier;
  readonly limit: number;
  readonly month: string;

  constructor(tier: Tier, limit: number, month: string) {
    super(`Project setup limit reached: ${limit}/${month} on ${tier} tier`);
    this.name = "ProjectLimitError";
    this.tier = tier;
    this.limit = limit;
    this.month = month;
  }
}
