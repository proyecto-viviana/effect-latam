import { parseModerationCategories } from "./guards";
import type {
  ModerationCategory,
  ModerationRecommendation,
  ModerationRecommendationAction,
} from "./types";

export type ModerationPolicyThresholds = {
  flagAt: number;
  hideAt: number;
  restrictAt: number;
  criticalCategoryRestrictAt: number;
};

export type ModerationPolicyInput = {
  recommendedAction?: ModerationRecommendationAction;
  riskScore: number;
  categories: readonly string[];
  source?: ModerationRecommendation["source"];
  detector?: string;
  reason?: string;
};

export const DEFAULT_MODERATION_POLICY_THRESHOLDS: ModerationPolicyThresholds = {
  flagAt: 0.45,
  hideAt: 0.75,
  restrictAt: 0.95,
  criticalCategoryRestrictAt: 0.85,
};

const criticalCategories = new Set<ModerationCategory>(["hate", "threat"]);
const actionRank: Record<ModerationRecommendationAction, number> = {
  allow: 0,
  flag: 1,
  hide: 2,
  restrict_user: 3,
};

export function applyModerationPolicy(
  input: ModerationPolicyInput,
  thresholds: ModerationPolicyThresholds = DEFAULT_MODERATION_POLICY_THRESHOLDS,
): ModerationRecommendation {
  const riskScore = clampRiskScore(input.riskScore);
  const categories = parseModerationCategories([...input.categories]);
  const hasCriticalCategory = categories.some((category) => criticalCategories.has(category));
  const thresholdAction = actionForRisk(riskScore, hasCriticalCategory, thresholds);
  const recommendedAction = input.recommendedAction ?? "allow";
  const action =
    actionRank[recommendedAction] >= actionRank[thresholdAction]
      ? recommendedAction
      : thresholdAction;

  return {
    action,
    riskScore,
    categories,
    source: input.source ?? "system",
    ...(input.detector ? { detector: input.detector } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

export function strongestModerationRecommendation(
  recommendations: readonly ModerationRecommendation[],
): ModerationRecommendation | null {
  if (recommendations.length === 0) return null;
  return recommendations.reduce((strongest, next) => {
    const strongestRank = actionRank[strongest.action];
    const nextRank = actionRank[next.action];
    if (nextRank > strongestRank) return next;
    if (nextRank === strongestRank && next.riskScore > strongest.riskScore) return next;
    return strongest;
  });
}

export function clampRiskScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function actionForRisk(
  riskScore: number,
  hasCriticalCategory: boolean,
  thresholds: ModerationPolicyThresholds,
): ModerationRecommendationAction {
  if (
    riskScore >= thresholds.restrictAt ||
    (hasCriticalCategory && riskScore >= thresholds.criticalCategoryRestrictAt)
  ) {
    return "restrict_user";
  }
  if (riskScore >= thresholds.hideAt) return "hide";
  if (riskScore >= thresholds.flagAt) return "flag";
  return "allow";
}
