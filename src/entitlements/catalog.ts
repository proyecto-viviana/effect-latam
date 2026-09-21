import {
  canDo,
  entitlementBag,
  type ActionDefinition,
  type Decision,
  type EntitlementBag,
} from "../vendor/entitlements/index";
import type { AuthUser } from "../auth/session";

export const ACTIONS = {
  "profile.update": {
    id: "profile.update",
    capabilities: ["capability:member"],
  },
  "forum.thread.create": {
    id: "forum.thread.create",
    capabilities: ["capability:member"],
  },
  "forum.reply.create": {
    id: "forum.reply.create",
    capabilities: ["capability:member"],
  },
  "forum.report.create": {
    id: "forum.report.create",
    capabilities: ["capability:member"],
  },
  "forum.moderate": {
    id: "forum.moderate",
    capabilities: ["capability:staff"],
  },
  "learn.visit.write": {
    id: "learn.visit.write",
    capabilities: ["capability:member"],
  },
} as const satisfies Record<string, ActionDefinition>;

export type ActionId = keyof typeof ACTIONS;

export function bagsForUser(user: AuthUser | null): EntitlementBag {
  if (!user) return entitlementBag({});
  const capabilities = ["capability:member"];
  if (user.role === "staff") capabilities.push("capability:staff");
  return entitlementBag({ capabilities });
}

export function decide(user: AuthUser | null, action: ActionId): Decision {
  return canDo({
    action: ACTIONS[action],
    allow: bagsForUser(user),
  });
}
