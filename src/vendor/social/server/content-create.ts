import { FORUM_BODY_MAX_LENGTH, THREAD_TITLE_MAX_LENGTH } from "./threads";

export const CONTENT_CREATE_CONTRACT_VERSION = "forum_content_create_v1" as const;
export const CONTENT_CREATE_OUTCOMES = ["applied", "replayed", "operation_conflict"] as const;

export type ContentCreateOutcome = (typeof CONTENT_CREATE_OUTCOMES)[number];

interface ContentCreateCommandBase {
  /** API boundaries must additionally enforce that this identifier is a UUID. */
  operationId: string;
  actorId: string;
}

export interface ContentCreateReplyCommand extends ContentCreateCommandBase {
  kind: "reply";
  threadId: string;
  content: string;
}

export interface ContentCreateThreadCommand extends ContentCreateCommandBase {
  kind: "thread";
  forumSlug: string;
  title: string;
  content: string;
}

export type ContentCreateCommand = ContentCreateReplyCommand | ContentCreateThreadCommand;

interface PreparedContentCreateFields {
  contractVersion: typeof CONTENT_CREATE_CONTRACT_VERSION;
  fingerprint: string;
}

export type PreparedContentCreateReplyCommand = ContentCreateReplyCommand &
  PreparedContentCreateFields;
export type PreparedContentCreateThreadCommand = ContentCreateThreadCommand &
  PreparedContentCreateFields;
export type PreparedContentCreateCommand =
  | PreparedContentCreateReplyCommand
  | PreparedContentCreateThreadCommand;

/** Compact projection of the immutable database operation row. */
export interface StoredContentCreateOperation {
  id: string;
  contractVersion: string;
  fingerprint: string;
  kind: string;
  actorId: string;
  requestedThreadId: string | null;
  requestedForumSlug: string | null;
  resultPostId: string | null;
  resultThreadId: string | null;
}

export type ContentCreatePreflightResult =
  | {
      outcome: "fresh";
      operationId: string;
      callerMayCommitEffects: false;
    }
  | {
      outcome: "replayed";
      operationId: string;
      id: string;
      callerMayCommitEffects: false;
    }
  | {
      outcome: "operation_conflict";
      operationId: string;
      callerMayCommitEffects: false;
    };

export type CommittedContentCreateResult =
  | {
      outcome: "applied";
      operationId: string;
      id: string;
      callerMayCommitEffects: true;
    }
  | Exclude<ContentCreatePreflightResult, { outcome: "fresh" }>
  | {
      outcome: "unclaimed";
      operationId: string;
      callerMayCommitEffects: false;
    };

function assertCanonicalIdentifier(name: string, value: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${name} must be a non-empty canonical identifier`);
  }
}

function normalizeBoundedText(name: string, value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${name} must not be empty`);
  if (normalized.length > maxLength) {
    throw new TypeError(`${name} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function normalizeContentCreateCommand(command: ContentCreateCommand): ContentCreateCommand {
  assertCanonicalIdentifier("operationId", command.operationId);
  assertCanonicalIdentifier("actorId", command.actorId);

  if (command.kind === "reply") {
    assertCanonicalIdentifier("threadId", command.threadId);
    return {
      ...command,
      content: normalizeBoundedText("content", command.content, FORUM_BODY_MAX_LENGTH),
    };
  }
  if (command.kind === "thread") {
    assertCanonicalIdentifier("forumSlug", command.forumSlug);
    return {
      ...command,
      title: normalizeBoundedText("title", command.title, THREAD_TITLE_MAX_LENGTH),
      content: normalizeBoundedText("content", command.content, FORUM_BODY_MAX_LENGTH),
    };
  }
  throw new TypeError("unknown content-create command kind");
}

function fingerprintPayload(command: ContentCreateCommand): readonly string[] {
  return command.kind === "reply"
    ? [CONTENT_CREATE_CONTRACT_VERSION, "reply", command.actorId, command.threadId, command.content]
    : [
        CONTENT_CREATE_CONTRACT_VERSION,
        "thread",
        command.actorId,
        command.forumSlug,
        command.title,
        command.content,
      ];
}

async function fingerprintNormalizedCommand(command: ContentCreateCommand): Promise<string> {
  const payload = JSON.stringify(fingerprintPayload(command));
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Stable fingerprint over the normalized, field-ordered v1 command. */
export async function contentCreateCommandFingerprint(
  command: ContentCreateCommand,
): Promise<string> {
  return fingerprintNormalizedCommand(normalizeContentCreateCommand(command));
}

/** Normalize once; persistence and recipient parsing must consume this result. */
export async function prepareContentCreateCommand(
  command: ContentCreateCommand,
): Promise<PreparedContentCreateCommand> {
  const normalized = normalizeContentCreateCommand(command);
  return {
    ...normalized,
    contractVersion: CONTENT_CREATE_CONTRACT_VERSION,
    fingerprint: await fingerprintNormalizedCommand(normalized),
  } as PreparedContentCreateCommand;
}

function storedResultId(operation: StoredContentCreateOperation): string {
  assertCanonicalIdentifier("stored operation id", operation.id);
  assertCanonicalIdentifier("stored actor id", operation.actorId);
  if (operation.contractVersion !== CONTENT_CREATE_CONTRACT_VERSION) {
    throw new TypeError("stored operation has an unsupported contract version");
  }
  if (!/^[0-9a-f]{64}$/.test(operation.fingerprint)) {
    throw new TypeError("stored operation has an invalid fingerprint");
  }

  if (operation.kind === "reply") {
    if (
      operation.requestedThreadId === null ||
      operation.requestedForumSlug !== null ||
      operation.resultPostId === null ||
      operation.resultThreadId !== null
    ) {
      throw new TypeError("stored reply operation has an invalid result shape");
    }
    assertCanonicalIdentifier("stored thread id", operation.requestedThreadId);
    assertCanonicalIdentifier("stored post id", operation.resultPostId);
    return operation.resultPostId;
  }
  if (operation.kind === "thread") {
    if (
      operation.requestedThreadId !== null ||
      operation.requestedForumSlug === null ||
      operation.resultPostId !== null ||
      operation.resultThreadId === null
    ) {
      throw new TypeError("stored thread operation has an invalid result shape");
    }
    assertCanonicalIdentifier("stored forum slug", operation.requestedForumSlug);
    assertCanonicalIdentifier("stored thread result id", operation.resultThreadId);
    return operation.resultThreadId;
  }
  throw new TypeError("stored operation has an invalid kind");
}

function assertReplayProvenance(
  requested: PreparedContentCreateCommand,
  stored: StoredContentCreateOperation,
): void {
  if (stored.kind !== requested.kind || stored.actorId !== requested.actorId) {
    throw new TypeError("stored operation provenance does not match its fingerprint");
  }
  if (
    (requested.kind === "reply" && stored.requestedThreadId !== requested.threadId) ||
    (requested.kind === "thread" && stored.requestedForumSlug !== requested.forumSlug)
  ) {
    throw new TypeError("stored operation context does not match its fingerprint");
  }
}

/** Classify an authenticated operation lookup before mutable write-policy gates. */
export function classifyExistingContentCreateOperation(
  requested: PreparedContentCreateCommand,
  stored: StoredContentCreateOperation | null,
): ContentCreatePreflightResult {
  if (!stored) {
    return {
      outcome: "fresh",
      operationId: requested.operationId,
      callerMayCommitEffects: false,
    };
  }

  const id = storedResultId(stored);
  if (stored.id !== requested.operationId) {
    throw new TypeError("stored operation does not match the requested operation ID");
  }
  if (stored.fingerprint !== requested.fingerprint) {
    return {
      outcome: "operation_conflict",
      operationId: requested.operationId,
      callerMayCommitEffects: false,
    };
  }
  assertReplayProvenance(requested, stored);
  return {
    outcome: "replayed",
    operationId: requested.operationId,
    id,
    callerMayCommitEffects: false,
  };
}

/**
 * Classify durable state after the D1 batch. Effect ownership requires the
 * batch's returned claim and a stored result equal to this invocation's
 * candidate; sharing an operation ID is not ownership.
 */
export function classifyCommittedContentCreateOperation(
  requested: PreparedContentCreateCommand,
  candidateResultId: string,
  callerClaimed: boolean,
  stored: StoredContentCreateOperation | null,
): CommittedContentCreateResult {
  assertCanonicalIdentifier("candidate result id", candidateResultId);
  const preflight = classifyExistingContentCreateOperation(requested, stored);
  if (preflight.outcome === "fresh") {
    if (callerClaimed) {
      throw new TypeError("claimed content-create operation has no durable row");
    }
    return {
      outcome: "unclaimed",
      operationId: requested.operationId,
      callerMayCommitEffects: false,
    };
  }
  if (preflight.outcome === "operation_conflict") {
    if (callerClaimed) {
      throw new TypeError("claimed content-create operation conflicts with durable state");
    }
    return preflight;
  }
  if (callerClaimed) {
    if (preflight.id !== candidateResultId) {
      throw new TypeError("claimed content-create operation does not own the candidate result");
    }
    return {
      outcome: "applied",
      operationId: requested.operationId,
      id: candidateResultId,
      callerMayCommitEffects: true,
    };
  }
  return preflight;
}
