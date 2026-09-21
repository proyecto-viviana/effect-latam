export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

export type ModerationSubjectType = "review" | "comment" | "message" | (string & {});

export type ModerationSubject = {
  type: ModerationSubjectType;
  id: string;
  ownerUserId?: string;
};

export type ModerationActorRole = "guest" | "user" | "owner" | "admin" | (string & {});

export type ModerationActor = {
  userId?: string;
  role?: ModerationActorRole;
  authenticated?: boolean;
};

export type ModerationTrace = {
  requestId?: string;
  correlationId?: string;
  causationId?: string;
  parentEventId?: string;
};

export type ModerationCategory =
  | "harassment"
  | "hate"
  | "threat"
  | "sexual"
  | "self_harm"
  | "spam"
  | "privacy"
  | "other";

export type ModerationContentStatus =
  | "visible"
  | "flagged"
  | "pending_review"
  | "hidden"
  | "deleted";
export type UserModerationState = "active" | "restricted" | "banned";
export type ModerationCaseStatus = "open" | "resolved";
export type ModerationCaseSource = "admin" | "ai" | "system" | "user_report";

export type ModerationRecommendationAction = "allow" | "flag" | "hide" | "restrict_user";

export type ModerationActionType =
  | ModerationRecommendationAction
  | "hold_for_review"
  | "restore_content"
  | "uphold"
  | "delete_content"
  | "ban_user"
  | "pin_thread"
  | "unpin_thread"
  | "lock_thread"
  | "unlock_thread"
  | "clear_restriction"
  | "mark_false_positive";

export type ModerationInput = {
  app: string;
  subject: ModerationSubject;
  actor?: ModerationActor;
  content: {
    text?: string;
    contentHash?: string;
    language?: string;
  };
  trace?: ModerationTrace;
  metadata?: JsonRecord;
};

export type ModerationRecommendation = {
  action: ModerationRecommendationAction;
  riskScore: number;
  categories: ModerationCategory[];
  source: ModerationCaseSource;
  detector?: string;
  reason?: string;
  evidence?: JsonRecord;
};

export type ModerationSkippedReason =
  | "disabled"
  | "empty_content"
  | "rate_limited"
  | "budget_exhausted"
  | "service_unavailable";

export type ModerationFailureReason =
  | "invalid_response"
  | "authorization_denied"
  | "detector_error"
  | "aborted";

export type ModerationDetectorResult =
  | { status: "completed"; recommendation: ModerationRecommendation }
  | { status: "skipped"; reason: ModerationSkippedReason; failOpen: true }
  | { status: "failed"; reason: ModerationFailureReason; failOpen: false };

export type ModerationCaseDraft = {
  id: string;
  app: string;
  subject: ModerationSubject;
  authorUserId?: string;
  source: ModerationCaseSource;
  status: ModerationCaseStatus;
  recommendation?: ModerationRecommendation;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminModerationDecision = {
  caseId: string;
  action: ModerationActionType;
  actorUserId: string;
  reason?: string;
  createdAt: Date;
  metadata?: JsonRecord;
};
