import { parseModerationActionType } from "./guards";
import type { AdminModerationDecision, JsonRecord, ModerationActionType } from "./types";

export type ManualModerationProjection<
  TSubjectId = string,
  TAction extends string = ModerationActionType,
> = {
  app: string;
  subject: { type: string; id: TSubjectId };
  actorUserId: string;
  action: TAction;
  reason?: string;
  operationId?: string;
};

export type ManualModerationProjectionInput = Omit<ManualModerationProjection, "action"> & {
  action: ModerationActionType | string;
};

function assertCanonicalIdentifier(name: string, value: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${name} must be a non-empty canonical identifier`);
  }
}

/**
 * Project a manual moderation request into identifiers safe for durable audit.
 * Product persistence still owns transactionality, replay, and effect ordering.
 */
export function createManualModerationProjection(
  input: ManualModerationProjectionInput,
): ManualModerationProjection {
  const action = parseModerationActionType(input.action);
  if (!action) {
    throw new TypeError(`Unsupported moderation action: ${String(input.action)}`);
  }

  assertCanonicalIdentifier("app", input.app);
  assertCanonicalIdentifier("subject.type", input.subject.type);
  assertCanonicalIdentifier("subject.id", input.subject.id);
  assertCanonicalIdentifier("actorUserId", input.actorUserId);
  if (input.operationId !== undefined) {
    assertCanonicalIdentifier("operationId", input.operationId);
  }
  if (input.reason !== undefined) {
    assertCanonicalIdentifier("reason", input.reason);
  }

  return {
    app: input.app,
    subject: { type: input.subject.type, id: input.subject.id },
    actorUserId: input.actorUserId,
    action,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(input.operationId !== undefined ? { operationId: input.operationId } : {}),
  };
}

export type AdminModerationDecisionInput = {
  caseId: string;
  action: ModerationActionType | string;
  actorUserId: string;
  reason?: string;
  createdAt?: Date;
  metadata?: JsonRecord;
};

export function createAdminModerationDecision(
  input: AdminModerationDecisionInput,
): AdminModerationDecision {
  const action = parseModerationActionType(input.action);
  if (!action) {
    throw new Error(`Unsupported moderation action: ${String(input.action)}`);
  }

  return {
    caseId: input.caseId,
    action,
    actorUserId: input.actorUserId,
    createdAt: input.createdAt ?? new Date(),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
