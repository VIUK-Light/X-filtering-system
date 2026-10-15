import { MVP_CATEGORIES } from "../shared/filter-core.ts";

const REASON_TEXT: Record<string, string> = {
  site_rule_block: "登録されたブロック用サイトルールに一致しました。",
  content_category_match: "端末内の本文判定で制限対象カテゴリを検出しました。",
  content_incomplete: "ページの一部を確認できず、安全判定を完了できませんでした。",
  empty_content: "確認できる本文がなく、分類できませんでした。",
  risky_tld_match: "URLのドメイン種別がローカル制限ルールに一致しました。",
  suspicious_redirect_match: "URLにローカルの不審な誘導ルールが一致しました。",
  local_classifier_unavailable: "端末内の判定を利用できませんでした。",
  document_unavailable: "ページ本文を取得できませんでした。",
};

function setText(id: string, value: string): void {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function showOptionalRow(rowId: string, textId: string, value: string | null): void {
  if (!value) return;
  const row = document.getElementById(rowId);
  if (row) row.hidden = false;
  setText(textId, value);
}

function renderPage(): void {
  const params = new URLSearchParams(location.search);
  const reason = params.get("reason") ?? "local_classifier_unavailable";
  const categoryId = params.get("category");
  const category = MVP_CATEGORIES.find((candidate) => candidate.id === categoryId);
  const uncertainty = params.get("uncertainty");

  setText("reason", REASON_TEXT[reason] ?? "ローカルルールによりページを止めました。");
  if (category) showOptionalRow("category-row", "category", category.title);
  if (uncertainty) {
    showOptionalRow(
      "uncertainty-row",
      "uncertainty",
      uncertainty === "truncated" ? "ページの一部を確認できていません。" : "一部コンテンツを確認できていません。",
    );
  }

  const url = params.get("url");
  if (url) {
    try {
      const parsed = new URL(url);
      setText("summary", `このページを表示できません: ${parsed.host}`);
    } catch {
      setText("summary", "ページを確認できなかったため、表示を止めています。");
    }
  }

  document.getElementById("back-button")?.addEventListener("click", () => history.back());
}

renderPage();
