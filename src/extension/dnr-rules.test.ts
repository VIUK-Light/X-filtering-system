import assert from "node:assert/strict";
import test from "node:test";
import { buildDNRRules } from "./dnr-rules.ts";
import type { SiteRule } from "../shared/filter-core.ts";

test("DNR rules redirect blocked top-level hosts with a category and reason", () => {
  const rules: SiteRule[] = [{ host: "https://Example.Invalid/path", action: "block", categoryId: "adult_content" }];
  const [rule] = buildDNRRules(rules);

  assert.equal(rule.condition.urlFilter, "||example.invalid^");
  assert.deepEqual(rule.condition.resourceTypes, ["main_frame"]);
  assert.equal(rule.action.type, "redirect");
  if (rule.action.type !== "redirect") assert.fail("expected redirect action");
  assert.match(rule.action.redirect.extensionPath, /^\/blocked\.html\?/);
  assert.match(rule.action.redirect.extensionPath, /category=adult_content/);
  assert.match(rule.action.redirect.extensionPath, /reason=site_rule_block/);
});

test("an allow host rule has higher priority than a matching block rule", () => {
  const rules = buildDNRRules([
    { host: "example.invalid", action: "block", categoryId: "adult_content" },
    { host: "trusted.example.invalid", action: "allow" },
  ]);

  assert.equal(rules[0].priority, 10);
  assert.equal(rules[1].priority, 20);
  assert.equal(rules[1].action.type, "allow");
});

test("invalid hosts are omitted from DNR rules", () => {
  const rules = buildDNRRules([{ host: "https://", action: "block" }]);
  assert.deepEqual(rules, []);
});
