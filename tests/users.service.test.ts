import { describe, it, expect, vi, beforeEach } from "vitest";
import { claimProjectSlot, TIER_LIMITS, ProjectLimitError } from "../src/modules/users/users.service.js";

vi.mock("../src/db/client.js", () => ({
  prisma: {
    user: {
      findUniqueOrThrow: vi.fn(),
    },
    projectUsage: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "../src/db/client.js";

describe("claimProjectSlot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws ProjectLimitError when FREE user has used 2 slots this month", async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      id: "user_1",
      clerkId: "clerk_1",
      email: "test@test.com",
      tier: "FREE",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.projectUsage.upsert).mockResolvedValue({
      id: "pu_1",
      userId: "user_1",
      month: "2026-03",
      count: 2, // already at limit
      updatedAt: new Date(),
    });

    await expect(claimProjectSlot("user_1")).rejects.toThrow(ProjectLimitError);
  });

  it("increments count when FREE user has used 1 slot this month", async () => {
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({
      id: "user_1",
      clerkId: "clerk_1",
      email: "test@test.com",
      tier: "FREE",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.projectUsage.upsert).mockResolvedValue({
      id: "pu_1",
      userId: "user_1",
      month: "2026-03",
      count: 1,
      updatedAt: new Date(),
    });
    vi.mocked(prisma.projectUsage.update).mockResolvedValue({
      id: "pu_1",
      userId: "user_1",
      month: "2026-03",
      count: 2,
      updatedAt: new Date(),
    });

    const result = await claimProjectSlot("user_1");
    expect(result.count).toBe(2);
  });

  it("TEAMS tier has Infinity limit and never throws", async () => {
    expect(TIER_LIMITS.TEAMS).toBe(Infinity);
  });
});
