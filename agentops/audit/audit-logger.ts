/**
 * Immutable Audit Trail System — Section 19: Compliance and Immutable Audit Trail
 *
 * Provides tamper-evident, append-only logging of all agent operations.
 * Each record is hash-chained to its predecessor using SHA-256, forming
 * a verifiable sequence that can detect insertions, deletions, or mutations.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActorRef {
  /** e.g. "agent", "human", "system" */
  type: string;
  /** Unique identifier for the actor */
  id: string;
}

export interface TokenUsage {
  input: number;
  output: number;
}

export interface AuditRecord {
  /** UUIDv4 unique to this event */
  eventId: string;
  /** Trace / correlation id shared across a logical operation */
  traceId: string;
  /** ISO-8601 timestamp of when the event was recorded */
  ts: string;
  /** The agent or system component that performed the action */
  actor: ActorRef;
  /** The human user on whose behalf the action was taken (may differ from actor) */
  originalUser: string;
  /** Canonical action name, e.g. "tool.invoke", "llm.call", "decision.escalate" */
  action: string;
  /** What was acted upon — resource URI, tool name, etc. */
  target: string;
  /** Truncated / sanitised summary of the input payload */
  input_summary: string;
  /** Truncated / sanitised summary of the output payload */
  output_summary: string;
  /** Result of the permission / policy check that gated the action */
  permissionCheck: string;
  /** Outcome: "success" | "failure" | "denied" | "error" */
  status: string;
  /** Token consumption for LLM calls */
  tokens: TokenUsage;
  /** SHA-256 hash chaining this record to the previous one */
  hash: string;
}

/**
 * Parameters accepted by {@link createAuditRecord}.
 * All fields of {@link AuditRecord} except the ones that are generated
 * automatically (eventId, ts, hash).
 */
export type CreateAuditRecordParams = Omit<AuditRecord, "eventId" | "ts" | "hash">;

export interface ChainVerificationResult {
  valid: boolean;
  /** 0-based index of the first record whose hash does not match */
  brokenAt?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUDIT_DIR = path.resolve(__dirname, ".");
const AUDIT_FILE = path.join(AUDIT_DIR, "audit-trail.jsonl");
const GENESIS_HASH = "0".repeat(64); // SHA-256 zero hash for the first record

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

let lastHash: string | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a v4-style UUID using the built-in crypto module. */
function uuidv4(): string {
  const bytes = crypto.randomBytes(16);
  // Set version (4) and variant (RFC 4122)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Compute the SHA-256 chain hash for a record.
 *
 * The hash covers every field of the record **except** the hash field itself,
 * concatenated with the previous record's hash to form the chain link.
 */
function computeHash(record: Omit<AuditRecord, "hash">, previousHash: string): string {
  const payload = JSON.stringify({
    eventId: record.eventId,
    traceId: record.traceId,
    ts: record.ts,
    actor: record.actor,
    originalUser: record.originalUser,
    action: record.action,
    target: record.target,
    input_summary: record.input_summary,
    output_summary: record.output_summary,
    permissionCheck: record.permissionCheck,
    status: record.status,
    tokens: record.tokens,
    previousHash,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Read the hash of the last record in the audit trail file.
 * Returns the genesis hash when the file does not exist or is empty.
 */
function readLastHashFromFile(): string {
  try {
    if (!fs.existsSync(AUDIT_FILE)) {
      return GENESIS_HASH;
    }
    const content = fs.readFileSync(AUDIT_FILE, "utf-8").trimEnd();
    if (content.length === 0) {
      return GENESIS_HASH;
    }
    const lines = content.split("\n");
    const lastLine = lines[lines.length - 1];
    const record: AuditRecord = JSON.parse(lastLine);
    return record.hash;
  } catch {
    return GENESIS_HASH;
  }
}

/**
 * Return the previous hash — from memory if available, otherwise from disk.
 */
function getPreviousHash(): string {
  if (lastHash !== null) {
    return lastHash;
  }
  lastHash = readLastHashFromFile();
  return lastHash;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new {@link AuditRecord} with an auto-generated eventId, timestamp,
 * and a SHA-256 hash chaining it to the previous record.
 */
export function createAuditRecord(params: CreateAuditRecordParams): AuditRecord {
  const partial: Omit<AuditRecord, "hash"> = {
    eventId: uuidv4(),
    ts: new Date().toISOString(),
    traceId: params.traceId,
    actor: params.actor,
    originalUser: params.originalUser,
    action: params.action,
    target: params.target,
    input_summary: params.input_summary,
    output_summary: params.output_summary,
    permissionCheck: params.permissionCheck,
    status: params.status,
    tokens: params.tokens,
  };

  const previousHash = getPreviousHash();
  const hash = computeHash(partial, previousHash);

  return { ...partial, hash };
}

/**
 * Append a fully-formed {@link AuditRecord} as a single NDJSON line to the
 * audit trail file. Creates the directory and file if they do not exist.
 *
 * After a successful write the in-memory lastHash is updated so subsequent
 * calls to {@link createAuditRecord} can chain without a disk read.
 */
export function appendAuditRecord(record: AuditRecord): void {
  // Ensure the directory exists
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  }

  const line = JSON.stringify(record) + "\n";
  fs.appendFileSync(AUDIT_FILE, line, "utf-8");

  // Update in-memory chain head
  lastHash = record.hash;
}

/**
 * Read every record from the audit trail and verify the hash chain from the
 * genesis record forward.
 *
 * @returns A {@link ChainVerificationResult} indicating whether the chain is
 *          intact. If broken, `brokenAt` is the 0-based index of the first
 *          record whose hash does not match the expected value.
 */
export function verifyChain(): ChainVerificationResult {
  if (!fs.existsSync(AUDIT_FILE)) {
    // No file means no records — vacuously valid.
    return { valid: true };
  }

  const content = fs.readFileSync(AUDIT_FILE, "utf-8").trimEnd();
  if (content.length === 0) {
    return { valid: true };
  }

  const lines = content.split("\n");
  let previousHash = GENESIS_HASH;

  for (let i = 0; i < lines.length; i++) {
    const record: AuditRecord = JSON.parse(lines[i]);

    // Reconstruct the expected hash from the record fields + previous hash
    const { hash: _storedHash, ...rest } = record;
    const expectedHash = computeHash(rest, previousHash);

    if (expectedHash !== record.hash) {
      return { valid: false, brokenAt: i };
    }

    previousHash = record.hash;
  }

  return { valid: true };
}

/**
 * Reset the in-memory last-hash cache. Useful in tests or after external
 * manipulation of the audit file.
 */
export function resetHashCache(): void {
  lastHash = null;
}
