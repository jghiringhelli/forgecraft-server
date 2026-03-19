/** Validated gate proposal — all required fields plus optional enrichment fields */
export interface GateProposal {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly domain: string;
  readonly gsProperty: string;
  readonly phase: "development" | "pre-release" | "rc" | "deployment" | "continuous";
  readonly check: string;
  readonly passCriterion: string;
  readonly evidence: string;
  readonly hook?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly priority?: string;
  readonly language?: string;
  readonly failureMessage?: string;
  readonly fixHint?: string;
  readonly likelihood?: string;
  readonly impact?: string;
  readonly confidence?: string;
}

/** Attribution info attached when mode is "attributed" */
export interface Attribution {
  readonly github?: string;
  readonly projectType?: string;
}

/** A gate entry as persisted in the quarantine directory */
export interface QuarantineEntry {
  readonly gate: GateProposal;
  readonly mode: "anonymous" | "attributed";
  readonly attribution?: Attribution;
  readonly quarantinedAt: string;
  readonly filename: string;
}
