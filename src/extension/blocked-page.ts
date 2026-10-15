import { MVP_CATEGORIES } from "../shared/filter-core.ts";

const REASON_TEXT: Record<string, string> = {
  site_rule_block: "このサイトは登録済みのドメイン制限ルールでブロックされています。",
  content_category_match: "ページの内容が制限対象に該当したため、表示できません。",
  content_incomplete: "ページの一部を確認できないため、表示を止めました。",
  empty_content: "ページの内容を確認できないため、表示を止めました。",
  risky_tld_match: "このサイトのアドレスは制限対象のため、表示できません。",
  suspicious_redirect_match: "不審な転送があるため、表示できません。",
  local_classifier_unavailable: "ページを確認できないため、表示を止めました。",
  document_unavailable: "ページを確認できないため、表示を止めました。",
};

const CANNOT_INSPECT_REASONS = new Set([
  "content_incomplete",
  "empty_content",
  "local_classifier_unavailable",
  "document_unavailable",
]);

function setText(id: string, value: string): void {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function showOptional(containerId: string, textId: string, value: string | null): void {
  if (!value) return;
  const container = document.getElementById(containerId);
  if (container) container.hidden = false;
  setText(textId, value);
}

function renderPage(): void {
  const params = new URLSearchParams(location.search);
  const reason = params.get("reason") ?? "local_classifier_unavailable";
  const categoryId = params.get("category");
  const category = MVP_CATEGORIES.find((candidate) => candidate.id === categoryId);
  const uncertainty = params.get("uncertainty");

  setText(
    "heading",
    CANNOT_INSPECT_REASONS.has(reason) ? "このページを確認できませんでした" : "このページはブロックされました",
  );
  setText("summary", REASON_TEXT[reason] ?? "制限ルールに一致したため、表示を止めました。");

  if (category) showOptional("category-row", "category", category.title);
  if (uncertainty && reason === "content_category_match") {
    showOptional(
      "uncertainty",
      "uncertainty",
      uncertainty === "truncated" ? "ページの一部を確認できていません。" : "一部の内容を確認できていません。",
    );
  }

  const url = params.get("url");
  if (url) {
    try {
      showOptional("site-row", "site-url", new URL(url).href);
    } catch {
      setText("summary", "ページを確認できなかったため、表示を止めました。");
    }
  }

  document.getElementById("back-button")?.addEventListener("click", () => history.back());
}

renderPage();
