import { Hono } from "hono";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const taxonomyRouter = new Hono();

taxonomyRouter.get("/", (c) => {
  const taxonomyPath =
    process.env.TAXONOMY_PATH ?? join(process.cwd(), "taxonomy.json");

  if (!existsSync(taxonomyPath)) {
    return c.json(
      {
        error:
          "taxonomy.json not found. Run npm run export:taxonomy in forgecraft-mcp.",
      },
      404
    );
  }

  const data = JSON.parse(readFileSync(taxonomyPath, "utf-8")) as unknown;
  return c.json(data);
});
