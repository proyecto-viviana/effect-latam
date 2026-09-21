import type { CapabilityId, DenyBag, EntitlementBag, Limit, QuotaId } from "./types";

export const EMPTY_ENTITLEMENT_BAG: EntitlementBag = {
  capabilities: new Set(),
  quotas: new Map(),
};

export const EMPTY_DENY_BAG: DenyBag = {
  actions: new Set(),
  capabilities: new Set(),
};

export function entitlementBag(input: {
  capabilities?: readonly CapabilityId[];
  quotas?: Readonly<Record<QuotaId, Limit>> | ReadonlyMap<QuotaId, Limit>;
}): EntitlementBag {
  return {
    capabilities: new Set(input.capabilities ?? []),
    quotas:
      input.quotas instanceof Map
        ? new Map(input.quotas)
        : new Map(Object.entries(input.quotas ?? {})),
  };
}

export function denyBag(input: {
  actions?: readonly string[];
  capabilities?: readonly CapabilityId[];
}): DenyBag {
  return {
    actions: new Set(input.actions ?? []),
    capabilities: new Set(input.capabilities ?? []),
  };
}

export function mergeEntitlementBags(...bags: readonly EntitlementBag[]): EntitlementBag {
  const capabilities = new Set<CapabilityId>();
  const quotas = new Map<QuotaId, Limit>();
  for (const bag of bags) {
    for (const capability of bag.capabilities) capabilities.add(capability);
    for (const [quota, limit] of bag.quotas)
      quotas.set(quota, mergeLimit(quotas.get(quota), limit));
  }
  return { capabilities, quotas };
}

export function mergeDenyBags(...bags: readonly DenyBag[]): DenyBag {
  const actions = new Set<string>();
  const capabilities = new Set<CapabilityId>();
  for (const bag of bags) {
    for (const action of bag.actions ?? []) actions.add(action);
    for (const capability of bag.capabilities ?? []) capabilities.add(capability);
  }
  return { actions, capabilities };
}

function mergeLimit(current: Limit | undefined, next: Limit): Limit {
  if (current === "unlimited" || next === "unlimited") return "unlimited";
  return Math.max(current ?? 0, next);
}
