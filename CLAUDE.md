# CLAUDE.md — forgecraft-server

> ForgeCraft sentinel. Read this file. Follow links only when needed.

## What this is
HTTP server for ForgeCraft MCP. Hono + Node.js. Provides:
- POST /contribute/gate — receive gate contributions, create GitHub issues
- GET /gates — proxy public quality-gates registry
- GET /taxonomy — serve forgecraft taxonomy
- GET /health — health check

## Architecture
Thin HTTP adapter layer only. No business logic. All validation via Zod at the boundary.
No database (stateless). Auth: Clerk JWT (future). Billing: Stripe (future).

## Standards
→ See https://github.com/jghiringhelli/forgecraft-mcp for the full methodology
