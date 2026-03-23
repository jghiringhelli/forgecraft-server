import { vi } from "vitest";

/** Auto-mock the Prisma client so tests that import app.ts don't need a real database. */
vi.mock("../src/db/client.js");
