import { normalizeHost, type SiteRule } from "../shared/filter-core.ts";

export const DNR_RULE_ID_START = 10_000;
export const MAX_SITE_RULES = 1_000;

export interface LocalDNRRule {
  id: number;
  priority: number;
  action:
    | { type: "allow" }
    | { type: "redirect"; redirect: { extensionPath: string } };
  condition: {
    urlFilter: string;
    resourceTypes: ["main_frame"];
  };
}

export function buildDNRRules(siteRules: SiteRule[]): LocalDNRRule[] {
  if (siteRules.length > MAX_SITE_RULES) {
    throw new RangeError(`At most ${MAX_SITE_RULES} site rules are supported by this prototype.`);
  }

  const normalized = siteRules.flatMap((rule) => {
    const host = normalizeHost(rule.host);
    if (!host) return [];
    return [{ ...rule, host }];
  });

  return normalized.map((rule, index) => {
    const base = {
      id: DNR_RULE_ID_START + index,
      priority: rule.action === "allow" ? 20 : 10,
      condition: {
        urlFilter: `||${rule.host}^`,
        resourceTypes: ["main_frame"] as ["main_frame"],
      },
    };

    if (rule.action === "allow") {
      return { ...base, action: { type: "allow" as const } };
    }

    const params = new URLSearchParams({ source: "url", reason: "site_rule_block" });
    if (rule.categoryId) params.set("category", rule.categoryId);
    return {
      ...base,
      action: {
        type: "redirect" as const,
        redirect: { extensionPath: `/blocked.html?${params.toString()}` },
      },
    };
  });
}
