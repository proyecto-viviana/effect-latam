import type { ModerationDetectionRun } from "./detector";
import type { ModerationInput, ModerationRecommendation, ModerationTrace } from "./types";

export type ModerationDecisionProjection = {
  app: string;
  subject: { type: string; id: string };
  trace?: ModerationTrace;
  disposition: ModerationDetectionRun["disposition"];
  recommendation: ModerationRecommendation | null;
};

export type ModerationCommitCommand<TPayload> = {
  decision: ModerationDecisionProjection;
  auditEvents: ModerationDetectionRun["auditEvents"];
  payload: TPayload;
};

/**
 * Application adapters commit the product effect and its audit events through
 * one durable boundary. Implementations should use one database transaction or
 * an equivalent atomic command; a separate best-effort audit write is invalid.
 */
export type ModerationApplicationAdapter<TPayload, TResult = void> = {
  commit(command: ModerationCommitCommand<TPayload>): Promise<TResult>;
};

export function createModerationCommitCommand<TPayload>(
  input: ModerationInput,
  run: ModerationDetectionRun,
  payload: TPayload,
): ModerationCommitCommand<TPayload> {
  return {
    decision: {
      app: input.app,
      subject: { type: input.subject.type, id: input.subject.id },
      ...(input.trace ? { trace: input.trace } : {}),
      disposition: run.disposition,
      recommendation: run.recommendation,
    },
    auditEvents: run.auditEvents,
    payload,
  };
}
