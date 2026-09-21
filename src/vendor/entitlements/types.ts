export type ActionId = string;
export type CapabilityId = string;
export type QuotaId = string;
export type Limit = number | "unlimited";

export type Counts = Readonly<Record<QuotaId, number>>;

export interface QuotaRequirement {
  readonly quota: QuotaId;
  readonly amount?: number;
}

export interface ActionDefinition {
  readonly id: ActionId;
  readonly capabilities?: readonly CapabilityId[];
  readonly requirements?: readonly QuotaRequirement[];
}

export interface EntitlementBag {
  readonly capabilities: ReadonlySet<CapabilityId>;
  readonly quotas: ReadonlyMap<QuotaId, Limit>;
}

export interface DenyBag {
  readonly actions?: ReadonlySet<ActionId>;
  readonly capabilities?: ReadonlySet<CapabilityId>;
}

export type Denial =
  | { readonly kind: "action_denied"; readonly action: ActionId }
  | { readonly kind: "action_ungranted"; readonly action: ActionId }
  | { readonly kind: "capability_denied"; readonly capability: CapabilityId }
  | { readonly kind: "capability_missing"; readonly capability: CapabilityId }
  | {
      readonly kind: "quota_exceeded";
      readonly quota: QuotaId;
      readonly limit: Limit;
      readonly used: number;
      readonly amount: number;
    };

export interface Decision {
  readonly allowed: boolean;
  readonly denials: readonly Denial[];
}
