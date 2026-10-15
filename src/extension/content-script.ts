import {
  evaluatePage,
  type FilterInput,
  type FilterResult,
  type SiteRule,
} from "../shared/filter-core.ts";

const SITE_RULES_KEY = "xfilter.siteRules";
const MAX_PAGE_TEXT = 30_000;

async function loadSiteRules(): Promise<SiteRule[]> {
  const stored = await chrome.storage.local.get(SITE_RULES_KEY);
  const value: unknown = stored[SITE_RULES_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is SiteRule => {
    if (typeof entry !== "object" || entry === null) return false;
    const rule = entry as Partial<SiteRule>;
    return typeof rule.host === "string" && (rule.action === "allow" || rule.action === "block");
  });
}

function makeInput(): FilterInput {
  const text = document.body?.innerText ?? document.body?.textContent ?? "";
  const isTruncated = text.length > MAX_PAGE_TEXT;
  const hasOpaqueMedia = document.body?.querySelector("img, video, audio, iframe, object, embed, canvas") !== null;
  return {
    url: location.href,
    title: document.title,
    bodyText: isTruncated ? text.slice(0, MAX_PAGE_TEXT) : text,
    isTruncated,
    // The single uncertainty bit describes media-only pages. A normal page
    // with visible text and an image is still evaluated from its readable text.
    hasUninspectableContent: text.trim().length === 0 && hasOpaqueMedia,
  };
}

function blockedPageURL(result: FilterResult, input: FilterInput): string {
  const destination = new URL(chrome.runtime.getURL("blocked.html"));
  destination.searchParams.set("source", "content");
  destination.searchParams.set("reason", result.reasonCode);
  destination.searchParams.set("url", input.url);
  const category = result.categories[0];
  if (category) destination.searchParams.set("category", category);
  if (result.uncertainty) destination.searchParams.set("uncertainty", result.uncertainty);
  return destination.toString();
}

function revealPage(): void {
  document.documentElement?.setAttribute("data-xfilter-revealed", "true");
}

async function inspectPage(): Promise<void> {
  const root = document.documentElement;
  if (!root) {
    redirectIndeterminate("document_unavailable");
    return;
  }

  try {
    const input = makeInput();
    const siteRules = await loadSiteRules();
    const result = evaluatePage(input, { siteRules });
    if (result.decision !== "allow") {
      location.replace(blockedPageURL(result, input));
      return;
    }
    revealPage();
  } catch (error) {
    console.error("SafeSearch 4 could not inspect this page.", error);
    redirectIndeterminate("local_classifier_unavailable");
  }
}

function redirectIndeterminate(reasonCode: string): void {
  const destination = new URL(chrome.runtime.getURL("blocked.html"));
  destination.searchParams.set("source", "runtime");
  destination.searchParams.set("reason", reasonCode);
  destination.searchParams.set("url", location.href);
  location.replace(destination.toString());
}

function startWhenBodyExists(): void {
  if (document.body) {
    void inspectPage();
    return;
  }
  document.addEventListener("DOMContentLoaded", () => void inspectPage(), { once: true });
}

startWhenBodyExists();
