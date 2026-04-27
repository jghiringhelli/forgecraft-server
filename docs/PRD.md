# PRD: forgecraft-server

**Version:** 0.2.0  
**Status:** Phase 1 — functional and deployable. Phase 2 — specced, not yet implemented.  
**Owner:** jghiringhelli  
**Repo:** jghiringhelli/forgecraft-server  
**Deployed on:** Railway  

---

## Background & Context

`forgecraft-server` is the HTTP backend for the ForgeCraft ecosystem. It has two distinct and clearly separated roles that must never bleed into one another:

1. **Gate Infrastructure (Phase 1)** — the live contribution pipeline that bridges `forgecraft-mcp` clients to the community quality-gates registry hosted at `jghiringhelli/quality-gates`. This includes gate contribution, registry proxying, taxonomy serving, and admin tools. This code is **real and functional** at v0.2.0.

2. **SaaS Billing Tier (Phase 2)** — Clerk authentication + Stripe subscriptions for Pro and Teams plans, database-backed API key validation, and per-project usage tracking. The Prisma schema is scaffolded but **no implementation exists**. Do not ship Phase 2 until fully specced and tested.

ForgeCraft MCP clients call this server at runtime to contribute gates and list approved gates. The server must be lightweight, reliable, and predictable. Over-engineering Phase 1 to accommodate Phase 2 prematurely is explicitly out of scope.

---

## Stakeholders

| Role | Who |
|---|---|
| Owner / engineer | jghiringhelli |
| Primary clients | forgecraft-mcp (programmatic), genspec-portal (taxonomy API) |
| Community contributors | developers submitting gates via `contribute_gate` action |
| Future paying users | individuals and teams on Pro/Teams plans (Phase 2) |
| Registry maintainer | jghiringhelli (reviews quarantined gate proposals on GitHub) |

---

## Phase 1: Gate Infrastructure

### Summary

Phase 1 is **complete and deployable**. All routes are implemented, validated with Zod, and covered by Vitest tests. The only remaining work is Railway deployment configuration and environment variable provisioning.

### What Phase 1 Delivers

| Capability | Route | Status |
|---|---|---|
| Health check | `GET /health` | ✅ Working |
| Gate contribution | `POST /contribute/gate` | ✅ Working |
| Registry proxy | `GET /gates` | ✅ Working |
| Taxonomy API | `GET /taxonomy` | ✅ Working |
| Admin quarantine viewer | `GET /quarantine` | ✅ Working |

### Environment Variables (Phase 1)

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | Yes | Opens GitHub Issues on `jghiringhelli/quality-gates` |
| `ADMIN_KEY` | No | Enables the `/quarantine` endpoint. If unset, endpoint returns 403. |
| `PORT` | No | Defaults to `3000` |
| `GATES_REGISTRY_URL` | No | Overrides registry fetch URL. Defaults to `https://raw.githubusercontent.com/jghiringhelli/quality-gates/master/index.json` |

### Phase 1 Key Decisions

- **Rate limiting is in-memory, per key, 20 contributions/month.** There is no database. This is intentional. The limit is lenient enough for legitimate use and simple enough to maintain before billing is real. Do not add database-backed rate limiting in Phase 1.
- **The `fg_` key format is stable.** API keys must match `fg_[a-zA-Z0-9]{32}`. This format will carry forward into Phase 2 without change.
- **Key validation is format-only in Phase 1.** The server checks that the header matches the regex — it does not look up keys in a database. This is acceptable until Phase 2 ships.
- **Phase 2 must not break Phase 1 behavior for free-tier users.** Free tier = current behavior. No regressions.

---

## UC-001: Contribute a Quality Gate

**Actor:** forgecraft-mcp client (automated, running in a developer's project)  
**Precondition:** Client has a valid `fg_`-prefixed API key. The developer has invoked `contribute_gate` in their session.  
**Action:** Client sends `POST /contribute/gate` with `X-Forgecraft-Key` header and a JSON body describing the gate proposal.  
**Postcondition:** A GitHub Issue is opened on `jghiringhelli/quality-gates` with labels `gate-proposal` and `quarantine`. The response body contains `{ issueUrl: string }`. The key's monthly contribution count is incremented.  

**Request schema (Zod-validated):**
```ts
{
  name: string,           // gate identifier, kebab-case
  description: string,    // what the gate checks
  tags: string[],         // ForgeCraft tag taxonomy values
  rationale: string,      // why this gate should exist
  examples?: string[]     // optional usage examples
}
```

**Error cases:**
- Missing or malformed `X-Forgecraft-Key` → `401 Unauthorized`
- Rate limit exceeded (20/month per key) → `429 Too Many Requests` with `{ retryAfter: string }` indicating next reset
- Invalid request body → `422 Unprocessable Entity` with Zod field errors
- GitHub API failure → `502 Bad Gateway`

**Acceptance criteria:**
- [ ] POST with valid key and body → 200 with `issueUrl` pointing to the opened issue
- [ ] POST with key that has sent 20 this month → 429
- [ ] POST with key that sent 19 this month → 200, count becomes 20
- [ ] POST with body missing `name` → 422 with field-level error
- [ ] POST with header `X-Forgecraft-Key: not_valid` → 401
- [ ] POST with header `X-Forgecraft-Key: fg_` + 31 chars → 401
- [ ] POST with header `X-Forgecraft-Key: fg_` + 32 alphanumeric chars → 200 (format-only validation)

---

## UC-002: List Approved Quality Gates

**Actor:** forgecraft-mcp client  
**Precondition:** None. This endpoint is public.  
**Action:** Client sends `GET /gates`.  
**Postcondition:** Server proxies `quality-gates/index.json` from GitHub raw content and returns it as-is. Response has `Content-Type: application/json`.  

**Error cases:**
- GitHub raw content fetch fails → `502 Bad Gateway`
- Registry URL misconfigured → `502 Bad Gateway`

**Acceptance criteria:**
- [ ] GET /gates → 200 with JSON array of gate definitions
- [ ] Response structure matches the schema defined in `quality-gates/index.json`
- [ ] If `GATES_REGISTRY_URL` env var is set, that URL is used instead of the default
- [ ] Upstream failure returns 502, not 500

---

## UC-003: Serve Tag Taxonomy

**Actor:** genspec-portal (web frontend), or any client needing the ForgeCraft tag taxonomy  
**Precondition:** None. Public endpoint.  
**Action:** Client sends `GET /taxonomy`.  
**Postcondition:** Server returns `taxonomy.json` as `application/json`.  

**Error cases:**
- `taxonomy.json` missing from server bundle → `500 Internal Server Error`

**Acceptance criteria:**
- [ ] GET /taxonomy → 200 with JSON object containing tag definitions
- [ ] Response is stable across deployments (file is bundled, not fetched)
- [ ] Content-Type is `application/json`

---

## UC-004: Health Check

**Actor:** Railway health probe, monitoring tools, developers  
**Precondition:** Server is running.  
**Action:** Client sends `GET /health`.  
**Postcondition:** Returns 200 with `{ status: "ok", version: string, timestamp: string, quarantineCount: number }`.  

**Acceptance criteria:**
- [ ] GET /health → 200 always (server is up)
- [ ] `version` matches `package.json` version field
- [ ] `timestamp` is a valid ISO 8601 string
- [ ] `quarantineCount` reflects open quarantine issues (or `-1` if GitHub token is unavailable)

---

## UC-005: View Quarantined Gate Proposals (Admin)

**Actor:** Registry maintainer (jghiringhelli)  
**Precondition:** `ADMIN_KEY` environment variable is set. Request includes `X-Admin-Key` header matching `ADMIN_KEY`.  
**Action:** Sends `GET /quarantine`.  
**Postcondition:** Returns list of open GitHub Issues on `jghiringhelli/quality-gates` that have the `quarantine` label.  

**Error cases:**
- Missing or wrong `X-Admin-Key` → `403 Forbidden`
- `ADMIN_KEY` not set → `403 Forbidden` (endpoint is disabled)
- GitHub API failure → `502 Bad Gateway`

**Acceptance criteria:**
- [ ] GET /quarantine with correct key → 200 with array of issue objects (`{ number, title, url, createdAt }`)
- [ ] GET /quarantine with wrong key → 403
- [ ] GET /quarantine when `ADMIN_KEY` unset → 403
- [ ] Each returned issue has `quarantine` label

---

## Phase 2: SaaS Billing Tier

### Summary

Phase 2 introduces user accounts, tiered API keys, Clerk SSO, and Stripe billing. **No Phase 2 code should be shipped until this PRD section is fully reviewed and implementation is ready.** The Prisma schema is scaffolded as a starting point — treat it as a draft, not a contract.

### Why Phase 2

Phase 1's format-only key validation and in-memory rate limiting are intentionally simple. As ForgeCraft grows, the server needs:
- **Identity** — know which user owns a key, enforce tier limits reliably
- **Persistence** — rate limits survive restarts; usage history is queryable
- **Monetization** — Pro and Teams plans fund continued development

### User Tiers

| Tier | Key type | Monthly gate contributions | Review priority | Price |
|---|---|---|---|---|
| FREE | Format-only (Phase 1 compat) | 20 | Standard | Free |
| PRO | DB-backed, per-user | 200 | Priority queue | TBD |
| TEAMS | DB-backed, per-org | 1000 (shared) | Priority queue | TBD |

### Data Model (Prisma — draft)

The Prisma schema scaffolds three models. These are drafts; finalize before implementing.

**User** — `id`, `clerkId`, `email`, `tier` (FREE | PRO | TEAMS), `createdAt`  
**ApiKey** — `id`, `key` (`fg_` + 32 chars), `userId`, `label`, `active`, `createdAt`, `lastUsedAt`  
**ProjectUsage** — `id`, `apiKeyId`, `month` (YYYY-MM), `contributionCount`  

Constraints:
- One user may have multiple API keys
- Keys are deactivatable without deletion (audit trail)
- `ProjectUsage` tracks per-key per-month; not per-user-aggregate (enables key-level analytics)

### Auth: Clerk SSO

- GitHub OAuth via Clerk (no username/password)
- Clerk webhook syncs user creation to Prisma `User` table
- JWT from Clerk verified on protected routes via Clerk middleware for Hono
- Public routes (`/health`, `/gates`, `/taxonomy`) remain unauthenticated
- Gate contribution (`POST /contribute/gate`) uses API key auth, not JWT — but key must be DB-validated in Phase 2

### Billing: Stripe

- Stripe Products: one per tier (PRO, TEAMS)
- Checkout session created server-side; client redirects to Stripe-hosted page
- Stripe webhook updates `User.tier` on subscription events (`checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`)
- Cancellation downgrades to FREE; existing keys remain active at FREE limits
- No trial periods in v1

### Phase 2 Use Cases

---

## UC-006: Register and Authenticate via GitHub SSO

**Actor:** Developer wanting a Pro or Teams subscription  
**Precondition:** User has a GitHub account. Clerk is configured with GitHub OAuth provider.  
**Action:** User visits the forgecraft dashboard (out of scope for this server — handled by genspec-portal or a dedicated frontend) and clicks "Sign in with GitHub". Clerk handles the OAuth flow and calls the server's Clerk webhook on first sign-in.  
**Postcondition:** A `User` record is created in the database with `tier: FREE`. The user receives a Clerk session token usable for authenticated API calls.  

**Acceptance criteria:**
- [ ] New GitHub sign-in → User record created with `tier: FREE`
- [ ] Repeat sign-in → no duplicate User record created (idempotent webhook)
- [ ] Clerk webhook endpoint rejects requests with invalid Clerk signature → 401
- [ ] User can immediately generate an API key after registration

---

## UC-007: Generate a Database-Backed API Key

**Actor:** Authenticated user (FREE, PRO, or TEAMS)  
**Precondition:** User is authenticated via Clerk JWT. User has fewer than the per-tier key limit.  
**Action:** User sends `POST /keys` with `{ label: string }`.  
**Postcondition:** A new `ApiKey` record is created. The raw key (`fg_` + 32 random alphanumeric chars) is returned **once** and never stored in plaintext (store hash only). User must copy it immediately.  

**Acceptance criteria:**
- [ ] POST /keys → 201 with `{ id, key, label, createdAt }`; key shown once
- [ ] Second fetch of the same key → returns `{ id, label, createdAt }` with no `key` field (hash only stored)
- [ ] Key matches `fg_[a-zA-Z0-9]{32}` format
- [ ] Unauthenticated POST /keys → 401

---

## UC-008: Validate API Key Against Database on Gate Contribution

**Actor:** forgecraft-mcp client  
**Precondition:** Phase 2 is shipped. Client's `fg_` key exists in the database and is active.  
**Action:** Client sends `POST /contribute/gate` with `X-Forgecraft-Key` header.  
**Postcondition:** Server looks up key hash in database, retrieves associated `User.tier`, applies tier-appropriate rate limit, then proceeds as in UC-001 if within limit.  

**Backward compatibility requirement:** A key that was valid in Phase 1 (format-only) must continue working in Phase 2 IF AND ONLY IF it has been registered in the database. There is no silent fallback to format-only validation in Phase 2.

**Acceptance criteria:**
- [ ] Valid DB-backed key, within tier limit → 200 (same as UC-001)
- [ ] Valid DB-backed key, at FREE tier limit (20) → 429
- [ ] Valid DB-backed key, at PRO tier limit (200) → 429
- [ ] Key with correct format but not in DB → 401 (no format-only fallback in Phase 2)
- [ ] Deactivated key → 401

---

## UC-009: Subscribe to Pro Plan via Stripe

**Actor:** Authenticated FREE-tier user  
**Precondition:** User is authenticated. Stripe is configured with PRO product.  
**Action:** User sends `POST /billing/checkout` with `{ plan: "PRO" }`. Server creates a Stripe Checkout Session and returns `{ checkoutUrl }`. User is redirected to Stripe.  
**Postcondition:** On successful payment, Stripe webhook fires `checkout.session.completed`. Server updates `User.tier` to `PRO`.  

**Acceptance criteria:**
- [ ] POST /billing/checkout with `plan: "PRO"` → 200 with `{ checkoutUrl }`
- [ ] Stripe webhook `checkout.session.completed` → User.tier updated to PRO
- [ ] Stripe webhook with invalid signature → 401
- [ ] After upgrade, POST /contribute/gate respects PRO rate limit (200/month)

---

## UC-010: Cancel Subscription and Downgrade to Free

**Actor:** Stripe (webhook) or authenticated user  
**Precondition:** User is on PRO or TEAMS plan.  
**Action:** User cancels in Stripe dashboard. Stripe fires `customer.subscription.deleted`.  
**Postcondition:** `User.tier` is set back to `FREE`. Existing API keys remain active but operate at FREE limits at the next billing cycle boundary.  

**Acceptance criteria:**
- [ ] `customer.subscription.deleted` webhook → User.tier = FREE
- [ ] Existing keys not deactivated on downgrade
- [ ] Contributions after downgrade counted against FREE limit (20/month)
- [ ] Re-subscribing restores PRO limits immediately on webhook receipt

---

## Non-Functional Requirements

### Performance
- `GET /health`, `GET /gates`, `GET /taxonomy` must respond in < 200ms (p99) under normal load
- `POST /contribute/gate` may take up to 2s due to GitHub API call; this is acceptable
- No heavy computation on the critical path

### Reliability
- Server must handle GitHub API being unavailable gracefully (return 502, do not crash)
- In-memory rate limiter state loss on restart is acceptable in Phase 1
- Phase 2 rate limiting must survive restarts (database-backed)

### Security
- `X-Forgecraft-Key` header must never be logged in plaintext
- `X-Admin-Key` must never be logged
- Stripe webhook signatures must be verified before processing
- Clerk webhook signatures must be verified before processing
- No PII in application logs

### Deployment
- Single Railway service
- Environment variables provisioned via Railway dashboard
- Health check at `GET /health` used as Railway readiness probe
- No persistent file storage on the server — taxonomy.json is bundled, not fetched

---

## Out of Scope

- A user-facing dashboard UI (that belongs to genspec-portal or a separate frontend project)
- Gate approval/rejection workflow (handled manually by maintainer via GitHub)
- Email notifications (not planned)
- Self-hosted deployment (Railway is the only supported target)
- Multi-region or CDN caching of `/gates` (add if needed after measuring latency)
- GitHub App integration (out of scope; personal token is sufficient for Phase 1)

---

## Success Metrics

**Phase 1:**
- Server is deployed on Railway and reachable at its public URL
- `POST /contribute/gate` successfully opens GitHub Issues for at least 3 real contributions
- Zero unhandled exceptions in production logs over 30-day window

**Phase 2:**
- At least 1 paying PRO subscriber within 60 days of Phase 2 launch
- API key validation latency adds < 50ms to `POST /contribute/gate` (DB lookup)
- Stripe webhook processing success rate > 99% (no missed tier upgrades/downgrades)

---

## Open Questions

1. **Stripe pricing** — PRO and TEAMS pricing has not been decided. Placeholder TBD until monetization strategy is confirmed.
2. **Key rotation in Phase 2** — should old Phase-1-style format-only keys auto-expire at a specific date, or remain valid indefinitely for users who never register? Decision needed before Phase 2 ships.
3. **TEAMS org model** — who is the "owner" of a TEAMS account? Does every team member get their own key, or do they share a pool? The Prisma schema assumes per-user keys, but TEAMS may need an `Organization` model. Revisit before implementing UC-010 equivalent for TEAMS.
4. **Rate limit reset cadence** — currently calendar-month. Should PRO reset on billing anniversary instead? Simpler UX but more complex implementation.
5. **Dashboard frontend** — Phase 2 requires a UI for key management and billing. Is this genspec-portal, a new repo, or a simple Clerk-hosted page?
