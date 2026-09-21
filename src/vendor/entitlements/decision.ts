import type {
  ActionDefinition,
  Counts,
  Decision,
  Denial,
  DenyBag,
  EntitlementBag,
  Limit,
} from "./types";

export interface CanDoInput {
  readonly action: ActionDefinition;
  readonly allow: EntitlementBag;
  readonly deny?: DenyBag;
  readonly counts?: Counts;
}

export function canDo(input: CanDoInput): Decision {
  const denials: Denial[] = [];
  const deny = input.deny;
  const action = input.action;

  if (deny?.actions?.has(action.id)) {
    denials.push({ kind: "action_denied", action: action.id });
  }

  const capabilities = action.capabilities ?? [];
  const requirements = action.requirements ?? [];

  // Default-deny: an action that declares neither a capability to hold nor a
  // quota to satisfy gates nothing, so the loops below would leave it allowed
  // for everyone (incl. guests / null roles). Require every action to declare
  // at least one capability or requirement to be permittable (ENTMOD-8).
  if (capabilities.length === 0 && requirements.length === 0) {
    denials.push({ kind: "action_ungranted", action: action.id });
  }

  for (const capability of capabilities) {
    if (deny?.capabilities?.has(capability)) {
      denials.push({ kind: "capability_denied", capability });
      continue;
    }
    if (!input.allow.capabilities.has(capability)) {
      denials.push({ kind: "capability_missing", capability });
    }
  }

  for (const requirement of requirements) {
    const amount = requirement.amount ?? 1;
    const used = input.counts?.[requirement.quota] ?? 0;
    const limit = input.allow.quotas.get(requirement.quota) ?? 0;
    if (!hasQuotaRoom(limit, used, amount)) {
      denials.push({
        kind: "quota_exceeded",
        quota: requirement.quota,
        limit,
        used,
        amount,
      });
    }
  }

  return { allowed: denials.length === 0, denials };
}

export function hasCapability(bag: EntitlementBag, capability: string): boolean {
  return bag.capabilities.has(capability);
}

export function checkQuota(
  bag: EntitlementBag,
  quota: string,
  used: number,
): { allowed: boolean; limit: Limit; used: number; remaining: Limit } {
  const limit = bag.quotas.get(quota) ?? 0;
  if (limit === "unlimited") {
    return { allowed: true, limit, used, remaining: "unlimited" };
  }
  const remaining = Math.max(0, limit - used);
  return { allowed: used < limit, limit, used, remaining };
}

function hasQuotaRoom(limit: Limit, used: number, amount: number): boolean {
  if (limit === "unlimited") return true;
  return used + amount <= limit;
}
