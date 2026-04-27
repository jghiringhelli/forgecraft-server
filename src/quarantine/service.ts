import { writeFileSync, readdirSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { GateProposal, Attribution, QuarantineEntry } from "../types/gate.js";

/**
 * Returns the quarantine directory path, resolved at call time so tests can
 * override QUARANTINE_DIR via environment variable before calling any function.
 */
function getQuarantineDir(): string {
  return process.env.QUARANTINE_DIR ?? join(process.cwd(), "quarantine");
}

function ensureQuarantineDir(): void {
  const dir = getQuarantineDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Persists a gate proposal to the quarantine directory.
 * Filename format: `{gateId}-{unixTimestampMs}.json`
 *
 * @param gate - The validated gate proposal
 * @param mode - Contribution mode
 * @param attribution - Optional attribution details
 * @returns The full quarantine entry as persisted to disk
 */
export function writeGateToQuarantine(
  gate: GateProposal,
  mode: "anonymous" | "attributed",
  attribution?: Attribution
): QuarantineEntry {
  ensureQuarantineDir();
  const quarantinedAt = new Date().toISOString();
  const filename = `${gate.id}-${Date.now()}.json`;
  const entry: QuarantineEntry = { gate, mode, attribution, quarantinedAt, filename };
  writeFileSync(join(getQuarantineDir(), filename), JSON.stringify(entry, null, 2), "utf-8");
  return entry;
}

/**
 * Reads and returns all entries from the quarantine directory.
 * @returns Array of quarantine entries, unsorted
 */
export function listQuarantineEntries(): ReadonlyArray<QuarantineEntry> {
  ensureQuarantineDir();
  const dir = getQuarantineDir();
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as QuarantineEntry);
}

/**
 * Returns the count of files currently in the quarantine directory.
 * Returns 0 if the directory does not exist yet.
 */
export function countQuarantineEntries(): number {
  const dir = getQuarantineDir();
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}

const QUALITY_GATES_REPO = "jghiringhelli/quality-gates";

/** Result of a deduplication search against existing GitHub Issues */
export interface DuplicateSearchResult {
  /** Exact duplicate found — same gate id in issue body */
  readonly exactMatch?: { issueUrl: string; issueNumber: number };
  /** Similar titles found — likely duplicates, let contributor decide */
  readonly suggestions: ReadonlyArray<{ title: string; issueUrl: string; issueNumber: number }>;
}

/**
 * Search existing gate proposal issues for duplicates before creating a new one.
 * Prevents the DX flood problem: 30 people submitting the same gate creates 1 issue, not 30.
 *
 * Strategy:
 *   1. Fetch all open issues labelled `gate-proposal` (max 100 — sufficient for early flywheel)
 *   2. Exact match: issue body contains `**ID:** \`{gateId}\``
 *   3. Similar title: Jaccard word-overlap ≥ 60% with the proposed title
 *
 * @param gateId - The proposed gate's id
 * @param gateTitle - The proposed gate's title
 * @param githubToken - GitHub PAT with issues:read scope
 * @returns DuplicateSearchResult — empty suggestions + no exactMatch means safe to create
 */
export async function searchExistingGateIssues(
  gateId: string,
  gateTitle: string,
  githubToken: string,
): Promise<DuplicateSearchResult> {
  const response = await fetch(
    `https://api.github.com/repos/${QUALITY_GATES_REPO}/issues?labels=gate-proposal&state=open&per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) return { suggestions: [] };

  const issues = (await response.json()) as Array<{
    number: number;
    title: string;
    html_url: string;
    body?: string;
  }>;

  const idMarker = `**ID:** \`${gateId}\``;
  const exactIssue = issues.find((i) => i.body?.includes(idMarker));
  if (exactIssue) {
    return {
      exactMatch: { issueUrl: exactIssue.html_url, issueNumber: exactIssue.number },
      suggestions: [],
    };
  }

  const proposed = tokenize(gateTitle);
  const suggestions = issues
    .filter((i) => jaccardSimilarity(proposed, tokenize(i.title)) >= 0.6)
    .map((i) => ({ title: i.title, issueUrl: i.html_url, issueNumber: i.number }));

  return { suggestions };
}

/**
 * Tokenize a string into lowercase words, stripping punctuation and common stop words.
 */
function tokenize(text: string): Set<string> {
  const STOP_WORDS = new Set(["gate", "proposal", "check", "the", "a", "an", "for", "and", "or"]);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Jaccard similarity between two token sets: |intersection| / |union|
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Opens a GitHub Issue for the quarantined gate. This is the primary durable record --
 * the issue IS the quarantine entry. Returns the issue URL.
 * Throws if GITHUB_TOKEN is missing or the API call fails.
 *
 * @param entry - The quarantine entry to report
 * @param githubToken - GitHub personal access token with `issues:write` scope
 * @param experimentId - Optional experiment identifier to add as an issue label
 * @returns The URL of the created GitHub issue
 */
export async function openGitHubIssue(
  entry: QuarantineEntry,
  githubToken: string,
  experimentId?: string,
): Promise<string> {
  const { gate } = entry;
  const labels = [
    "gate-proposal",
    "quarantine",
    ...(gate.tags ?? []).map((t) => t.toLowerCase()),
    ...(experimentId ? [experimentId] : []),
  ];

  const response = await fetch(
    `https://api.github.com/repos/${QUALITY_GATES_REPO}/issues`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title: `[Gate Proposal] ${gate.title}`,
        body: buildIssueBody(entry),
        labels,
      }),
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub API responded ${response.status}: ${detail}`);
  }

  const data = await response.json() as { html_url: string };
  return data.html_url;
}

/**
 * Lists open quarantine issues from the GitHub repository.
 * Returns the issue number, title, URL, and creation date.
 *
 * @param githubToken - GitHub personal access token with `issues:read` scope
 * @returns Array of open quarantine issues
 */
export async function listQuarantineIssues(
  githubToken: string
): Promise<ReadonlyArray<{ number: number; title: string; url: string; createdAt: string }>> {
  const response = await fetch(
    `https://api.github.com/repos/${QUALITY_GATES_REPO}/issues?labels=quarantine&state=open&per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API responded ${response.status}`);
  }

  const issues = await response.json() as Array<{
    number: number;
    title: string;
    html_url: string;
    created_at: string;
  }>;

  return issues.map((i) => ({
    number: i.number,
    title: i.title,
    url: i.html_url,
    createdAt: i.created_at,
  }));
}

/**
 * Formats a quarantine entry as a GitHub Issue body in Markdown.
 * @param entry - The quarantine entry
 * @returns Formatted markdown string
 */
function buildIssueBody(entry: QuarantineEntry): string {
  const { gate, mode } = entry;
  return `## Gate Proposal: ${gate.title}

**ID:** \`${gate.id}\`
**Domain:** ${gate.domain}
**GS Property:** ${gate.gsProperty}
**Phase:** ${gate.phase}
**Priority:** ${gate.priority ?? "not set"}
**Tags:** ${gate.tags?.join(", ") ?? "UNIVERSAL"}
**Language:** ${gate.language ?? "any"}

### Description
${gate.description}

### Check
${gate.check}

### Pass Criterion
${gate.passCriterion}

### Failure Message
${gate.failureMessage ?? "not provided"}

### Fix Hint
${gate.fixHint ?? "not provided"}

### Evidence
${gate.evidence}

### Risk Assessment
- Likelihood: ${gate.likelihood ?? "not assessed"}
- Impact: ${gate.impact ?? "not assessed"}
- Confidence: ${gate.confidence ?? "not assessed"}

---
*Submitted via forgecraft-mcp. Contributor mode: ${mode}*
`;
}
