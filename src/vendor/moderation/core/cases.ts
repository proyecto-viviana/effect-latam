import type { ModerationCaseDraft, ModerationInput, ModerationRecommendation } from "./types";

export type CreateModerationCaseDraftInput = {
  id: string;
  input: ModerationInput;
  recommendation?: ModerationRecommendation;
  createdAt?: Date;
};

export function createModerationCaseDraft(
  params: CreateModerationCaseDraftInput,
): ModerationCaseDraft {
  const now = params.createdAt ?? new Date();
  return {
    id: params.id,
    app: params.input.app,
    subject: params.input.subject,
    source: params.recommendation?.source ?? "system",
    status: "open",
    createdAt: now,
    updatedAt: now,
    ...(params.input.actor?.userId ? { authorUserId: params.input.actor.userId } : {}),
    ...(params.recommendation ? { recommendation: params.recommendation } : {}),
  };
}
