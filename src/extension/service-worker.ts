import { buildDNRRules, DNR_RULE_ID_START } from "./dnr-rules.ts";
import type { SiteRule } from "../shared/filter-core.ts";

const SITE_RULES_KEY = "xfilter.siteRules";
const MANAGED_RULE_ID_END = DNR_RULE_ID_START + 10_000;

async function readSiteRules(): Promise<SiteRule[]> {
  const stored = await chrome.storage.local.get(SITE_RULES_KEY);
  const value: unknown = stored[SITE_RULES_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter(isSiteRule);
}

function isSiteRule(value: unknown): value is SiteRule {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SiteRule>;
  return (
    typeof candidate.host === "string" &&
    (candidate.action === "allow" || candidate.action === "block") &&
    (candidate.categoryId === undefined || typeof candidate.categoryId === "string")
  );
}

async function refreshDNRRules(): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const managed = existing
    .filter((rule) => rule.id >= DNR_RULE_ID_START && rule.id < MANAGED_RULE_ID_END)
    .map((rule) => rule.id);
  const next = buildDNRRules(await readSiteRules());

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: managed,
    addRules: next,
  });
}

function reportRuleError(error: unknown): void {
  console.error("SafeSearch 4 could not update local URL rules.", error);
}

chrome.runtime.onInstalled.addListener(() => {
  void refreshDNRRules().catch(reportRuleError);
});

chrome.runtime.onStartup.addListener(() => {
  void refreshDNRRules().catch(reportRuleError);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && SITE_RULES_KEY in changes) {
    void refreshDNRRules().catch(reportRuleError);
  }
});
