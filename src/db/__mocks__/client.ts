import { vi } from "vitest";

export const prisma = {
  user: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  apiKey: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  projectUsage: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
};
