import { MVP_CATEGORIES, normalizeHost, type SiteRule } from "../shared/filter-core.ts";

const SITE_RULES_KEY = "xfilter.siteRules";
const form = document.getElementById("rule-form") as HTMLFormElement;
const hostField = document.getElementById("host") as HTMLInputElement;
const actionField = document.getElementById("action") as HTMLSelectElement;
const categoryField = document.getElementById("category") as HTMLSelectElement;
const categoryContainer = document.getElementById("category-field") as HTMLDivElement;
const message = document.getElementById("form-message") as HTMLParagraphElement;
const list = document.getElementById("rule-list") as HTMLUListElement;
const count = document.getElementById("rule-count") as HTMLParagraphElement;

for (const category of MVP_CATEGORIES) {
  const option = document.createElement("option");
  option.value = category.id;
  option.textContent = category.title;
  categoryField.append(option);
}

actionField.addEventListener("change", () => {
  categoryContainer.hidden = actionField.value !== "block";
});

async function loadRules(): Promise<SiteRule[]> {
  const stored = await chrome.storage.local.get(SITE_RULES_KEY);
  const value: unknown = stored[SITE_RULES_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is SiteRule => {
    if (typeof entry !== "object" || entry === null) return false;
    const rule = entry as Partial<SiteRule>;
    return typeof rule.host === "string" && (rule.action === "allow" || rule.action === "block");
  });
}

function renderRules(rules: SiteRule[]): void {
  list.replaceChildren();
  count.textContent = `${rules.length} 件`;

  if (rules.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "ルールはまだありません。最初は example.invalid のようなテスト用ホストを追加できます。";
    list.append(empty);
    return;
  }

  rules.forEach((rule, index) => {
    const item = document.createElement("li");
    item.className = "rule";

    const main = document.createElement("div");
    main.className = "rule-main";
    const host = document.createElement("span");
    host.className = "rule-host";
    host.textContent = rule.host;
    const meta = document.createElement("span");
    meta.className = "rule-meta";
    const category = MVP_CATEGORIES.find((candidate) => candidate.id === rule.categoryId)?.title;
    meta.textContent = rule.action === "allow" ? "許可ルール" : `ブロック · ${category ?? "カテゴリなし"}`;
    main.append(host, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "削除";
    remove.setAttribute("aria-label", `${rule.host} のルールを削除`);
    remove.addEventListener("click", () => {
      const next = rules.filter((_, currentIndex) => currentIndex !== index);
      void saveRules(next);
    });

    item.append(main, remove);
    list.append(item);
  });
}

async function saveRules(rules: SiteRule[]): Promise<void> {
  await chrome.storage.local.set({ [SITE_RULES_KEY]: rules });
  renderRules(rules);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const host = normalizeHost(hostField.value);
  if (!host) {
    message.textContent = "有効なホスト名またはURLを入力してください。";
    hostField.focus();
    return;
  }

  void loadRules().then(async (rules) => {
    const action = actionField.value === "allow" ? "allow" : "block";
    const categoryId = action === "block"
      ? MVP_CATEGORIES.find((candidate) => candidate.id === categoryField.value)?.id
      : undefined;
    if (action === "block" && !categoryId) {
      message.textContent = "ブロックカテゴリを選択してください。";
      return;
    }
    const nextRule: SiteRule = action === "block"
      ? { host, action, categoryId }
      : { host, action };
    const next = [...rules.filter((rule) => rule.host !== host), nextRule];
    if (next.length > 1_000) {
      message.textContent = "試作版ではサイトルールは1,000件までです。";
      return;
    }
    await saveRules(next);
    form.reset();
    categoryContainer.hidden = false;
    message.textContent = `${host} を保存しました。`;
  }).catch((error: unknown) => {
    console.error("Could not save site rule.", error);
    message.textContent = "ルールを保存できませんでした。もう一度お試しください。";
  });
});

void loadRules()
  .then(renderRules)
  .catch((error: unknown) => {
    console.error("Could not load site rules.", error);
    count.textContent = "読み込めませんでした";
  });
