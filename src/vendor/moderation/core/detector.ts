import { strongestModerationRecommendation } from "./policy";
import type {
  ModerationDetectorResult,
  ModerationInput,
  ModerationRecommendation,
  ModerationSkippedReason,
  ModerationTrace,
} from "./types";

export type ModerationDetectorContext = {
  now?: Date;
  signal?: AbortSignal;
};

export type ModerationDetector = {
  name: string;
  evaluate(
    input: ModerationInput,
    context?: ModerationDetectorContext,
  ): Promise<ModerationDetectorResult>;
};

export type ModerationDetectionRun = {
  status: "completed" | "skipped" | "failed";
  disposition: "recommended" | "allow_unchecked" | "hold_for_review";
  recommendation: ModerationRecommendation | null;
  results: ModerationDetectorExecution[];
  auditEvents: ModerationDetectorAuditEvent[];
};

export type ModerationDetectorExecution = {
  detector: string;
  result: ModerationDetectorResult;
};

export type ModerationDetectorAuditEvent = {
  name:
    | "moderation.detector.completed"
    | "moderation.detector.skipped"
    | "moderation.detector.failed";
  occurredAt: string;
  app: string;
  subject: { type: string; id: string };
  detector: string;
  outcome: "recommended" | "fail_open" | "fail_closed";
  trace?: ModerationTrace;
  reason?:
    | ModerationSkippedReason
    | "invalid_response"
    | "authorization_denied"
    | "detector_error"
    | "aborted";
  recommendation?: Pick<ModerationRecommendation, "action" | "riskScore" | "categories" | "source">;
};

export async function runModerationDetectors(
  detectors: readonly ModerationDetector[],
  input: ModerationInput,
  context: ModerationDetectorContext = {},
): Promise<ModerationDetectionRun> {
  if (detectors.length === 0) {
    return {
      status: "skipped",
      disposition: "allow_unchecked",
      recommendation: null,
      results: [],
      auditEvents: [],
    };
  }

  const occurredAt = (context.now ?? new Date()).toISOString();
  const results: ModerationDetectorExecution[] = [];
  for (const detector of detectors) {
    if (context.signal?.aborted) {
      results.push({
        detector: detector.name,
        result: { status: "failed", reason: "aborted", failOpen: false },
      });
      break;
    }

    try {
      const result = await detector.evaluate(input, context);
      results.push({ detector: detector.name, result });
      if (result.status === "failed" && result.reason === "aborted") break;
    } catch {
      const aborted = context.signal?.aborted === true;
      results.push({
        detector: detector.name,
        result: {
          status: "failed",
          reason: aborted ? "aborted" : "detector_error",
          failOpen: false,
        },
      });
      if (aborted) break;
    }
  }

  const recommendations = results.flatMap(({ result }) =>
    result.status === "completed" ? [result.recommendation] : [],
  );
  const failedClosed = results.some(({ result }) => result.status === "failed");
  const recommendation = strongestModerationRecommendation(recommendations);
  const auditEvents = results.map(({ detector, result }): ModerationDetectorAuditEvent => {
    const base = {
      occurredAt,
      app: input.app,
      subject: { type: input.subject.type, id: input.subject.id },
      detector,
      ...(input.trace ? { trace: input.trace } : {}),
    };
    if (result.status === "completed") {
      const { action, riskScore, categories, source } = result.recommendation;
      return {
        ...base,
        name: "moderation.detector.completed",
        outcome: "recommended",
        recommendation: { action, riskScore, categories, source },
      };
    }
    if (result.status === "skipped") {
      return {
        ...base,
        name: "moderation.detector.skipped",
        outcome: "fail_open",
        reason: result.reason,
      };
    }
    return {
      ...base,
      name: "moderation.detector.failed",
      outcome: "fail_closed",
      reason: result.reason,
    };
  });

  return {
    status: failedClosed ? "failed" : recommendation ? "completed" : "skipped",
    disposition: failedClosed
      ? "hold_for_review"
      : recommendation
        ? "recommended"
        : "allow_unchecked",
    recommendation,
    results,
    auditEvents,
  };
}
