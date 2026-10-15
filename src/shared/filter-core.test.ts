import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluatePage,
  hostMatchesRule,
  normalizeHost,
  type FilterInput,
  type SiteRule,
} from "./filter-core.ts";

function page(overrides: Partial<FilterInput> = {}): FilterInput {
  return {
    url: "https://example.invalid/article",
    title: "A normal page",
    bodyText: "A short, ordinary article about gardening.",
    isTruncated: false,
    hasUninspectableContent: false,
    ...overrides,
  };
}

test("normalizes URL hosts, case, whitespace, ports, and leading www", () => {
  assert.equal(normalizeHost(" HTTPS://WWW.Example.COM:8443/path?q=1 "), "example.com");
  assert.equal(normalizeHost("sub.example.com/path"), "sub.example.com");
  assert.equal(normalizeHost(""), null);
  assert.equal(normalizeHost("https://"), null);
});

test("matches exact hosts and dot-delimited subdomains, not lookalike suffixes", () => {
  assert.equal(hostMatchesRule("example.com", "example.com"), true);
  assert.equal(hostMatchesRule("www.example.com", "example.com"), true);
  assert.equal(hostMatchesRule("shop.eu.example.com", "example.com"), true);
  assert.equal(hostMatchesRule("notexample.com", "example.com"), false);
  assert.equal(hostMatchesRule("example.com.attacker.invalid", "example.com"), false);
});

test("URL rules return a URL-stage block with its category and matched host", () => {
  const rules: SiteRule[] = [
    { host: "https://Bad.Example.invalid/path", action: "block", categoryId: "phishing" },
  ];
  const result = evaluatePage(page({ url: "https://shop.bad.example.invalid/" }), { siteRules: rules });

  assert.equal(result.decision, "block");
  assert.equal(result.stage, "url");
  assert.equal(result.reasonCode, "site_rule_block");
  assert.deepEqual(result.categories, ["phishing"]);
  assert.deepEqual(result.matchedKeywords, ["bad.example.invalid"]);
});

test("a more-specific allow rule overrides a parent block rule", () => {
  const rules: SiteRule[] = [
    { host: "example.invalid", action: "block", categoryId: "violence" },
    { host: "docs.example.invalid", action: "allow" },
  ];
  const result = evaluatePage(page({ url: "https://docs.example.invalid/guide" }), { siteRules: rules });

  assert.equal(result.decision, "allow");
  assert.equal(result.reasonCode, "site_rule_allow");
  assert.deepEqual(result.categories, []);
});

test("URL and body keyword hits return a category block", () => {
  const bodyResult = evaluatePage(page({ bodyText: "adult porn xxx nude video" }));
  const urlResult = evaluatePage(page({ url: "https://adult-porn-xxx-nude.example.invalid/" }));

  assert.equal(bodyResult.decision, "block");
  assert.equal(bodyResult.stage, "content");
  assert.deepEqual(bodyResult.categories, ["adult_content"]);
  assert.equal(bodyResult.reasonCode, "content_category_match");
  assert.ok(bodyResult.matchedKeywords.includes("porn"));

  assert.equal(urlResult.decision, "block");
  assert.deepEqual(urlResult.categories, ["adult_content"]);
});

test("disabled categories allow their content candidates while reporting the skipped category", () => {
  const result = evaluatePage(
    page({ bodyText: "adult porn xxx nude video" }),
    { enabledCategories: ["violence"] },
  );

  assert.equal(result.decision, "allow");
  assert.equal(result.stage, "content");
  assert.equal(result.reasonCode, "category_disabled");
  assert.deepEqual(result.categories, ["adult_content"]);
});

test("an enabled category still blocks when a disabled category appears earlier", () => {
  const result = evaluatePage(
    page({ bodyText: "adult porn xxx nude video 暴力 殺人 グロ 死体" }),
    { enabledCategories: ["violence"] },
  );

  assert.equal(result.decision, "block");
  assert.equal(result.reasonCode, "content_category_match");
  assert.deepEqual(result.categories, ["violence"]);
});

test("explicit site rules take precedence over category toggles", () => {
  const blocked = evaluatePage(
    page({ url: "https://blocked.example.invalid/page" }),
    {
      enabledCategories: ["violence"],
      siteRules: [{ host: "example.invalid", action: "block", categoryId: "adult_content" }],
    },
  );
  const allowed = evaluatePage(
    page({ url: "https://docs.example.invalid/guide" }),
    {
      enabledCategories: [],
      siteRules: [
        { host: "example.invalid", action: "block", categoryId: "violence" },
        { host: "docs.example.invalid", action: "allow" },
      ],
    },
  );

  assert.equal(blocked.decision, "block");
  assert.deepEqual(blocked.categories, ["adult_content"]);
  assert.equal(allowed.decision, "allow");
  assert.equal(allowed.reasonCode, "site_rule_allow");
});

test("a disabled-category match remains indeterminate when inspection is incomplete", () => {
  const result = evaluatePage(
    page({ bodyText: "adult porn xxx nude video", isTruncated: true }),
    { enabledCategories: ["violence"] },
  );

  assert.equal(result.decision, "indeterminate");
  assert.equal(result.reasonCode, "content_incomplete");
  assert.equal(result.uncertainty, "truncated");
  assert.deepEqual(result.categories, []);
});

test("known search-result URLs suppress lexical category hits", () => {
  const result = evaluatePage(page({
    url: "https://www.google.com/search?q=porn",
    bodyText: "porn xxx adult nude videos",
  }));

  assert.equal(result.decision, "allow");
  assert.equal(result.reasonCode, "search_context_suppressed");
  assert.deepEqual(result.categories, []);
});

test("authentication text in page chrome does not suppress unrelated adult-content evidence", () => {
  const result = evaluatePage(page({
    title: "Adult video index",
    bodyText: "Free porn, sex, tube videos, and XXX pics. Sign in to your account.",
  }));

  assert.equal(result.decision, "block");
  assert.equal(result.reasonCode, "content_category_match");
  assert.deepEqual(result.categories, ["adult_content"]);
});

test("English sexual-health education context does not become an adult-content block", () => {
  const result = evaluatePage(page({
    title: "Home - Advocates for Youth",
    bodyText: "Sexual health education helps young people learn about reproductive health and safety.",
  }));

  assert.equal(result.decision, "allow");
  assert.equal(result.reasonCode, "content_no_match");
  assert.deepEqual(result.categories, []);
});

test("technical and learning context suppresses educational adult and generic phishing hits", () => {
  const adultResult = evaluatePage(page({
    url: "https://github.com/example/project",
    bodyText: "README documentation for research shows porn xxx adult nude as test strings.",
  }));
  const phishingResult = evaluatePage(page({
    url: "https://github.com/example/project",
    bodyText: "README package.json explains verify password handling.",
  }));

  assert.equal(adultResult.decision, "allow");
  assert.equal(phishingResult.decision, "allow");
  assert.deepEqual(adultResult.categories, []);
  assert.deepEqual(phishingResult.categories, []);
});

test("strict mode categorizes suspicious executable redirects and risky TLDs", () => {
  const redirect = evaluatePage(page({
    url: "https://downloads.example.invalid/redirect.exe",
  }), { strictMode: true });
  const riskyTld = evaluatePage(page({
    url: "https://casino.example.bet/",
  }), { strictMode: true });

  assert.equal(redirect.decision, "block");
  assert.equal(redirect.reasonCode, "suspicious_redirect_match");
  assert.deepEqual(redirect.categories, ["suspicious_redirect"]);
  assert.equal(riskyTld.decision, "block");
  assert.equal(riskyTld.reasonCode, "risky_tld_match");
  assert.deepEqual(riskyTld.categories, ["gambling"]);
});

test("truncated and uninspectable text remain indeterminate when no category is found", () => {
  const truncated = evaluatePage(page({ isTruncated: true }));
  const uninspectable = evaluatePage(page({ hasUninspectableContent: true }));

  assert.equal(truncated.decision, "indeterminate");
  assert.equal(truncated.stage, "runtime");
  assert.equal(truncated.reasonCode, "content_incomplete");
  assert.equal(truncated.uncertainty, "truncated");
  assert.deepEqual(truncated.categories, []);

  assert.equal(uninspectable.decision, "indeterminate");
  assert.equal(uninspectable.uncertainty, "uninspectable");
  assert.deepEqual(uninspectable.categories, []);
});

test("a visible category block is retained together with partial-content uncertainty", () => {
  const result = evaluatePage(page({
    bodyText: "adult porn xxx nude videos",
    isTruncated: true,
    hasUninspectableContent: true,
  }));

  assert.equal(result.decision, "block");
  assert.deepEqual(result.categories, ["adult_content"]);
  assert.equal(result.uncertainty, "uninspectable");
});

test("empty or unsupported page text is indeterminate with no invented category", () => {
  const empty = evaluatePage(page({ title: "", bodyText: "" }));
  const unsupported = evaluatePage(page({
    title: "",
    bodyText: "",
    hasUninspectableContent: true,
  }));

  assert.equal(empty.decision, "indeterminate");
  assert.equal(empty.stage, "runtime");
  assert.equal(empty.reasonCode, "empty_content");
  assert.deepEqual(empty.categories, []);

  assert.equal(unsupported.decision, "indeterminate");
  assert.equal(unsupported.reasonCode, "content_incomplete");
  assert.equal(unsupported.uncertainty, "uninspectable");
  assert.deepEqual(unsupported.categories, []);
});
