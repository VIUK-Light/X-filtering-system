/**
 * Browser- and OS-independent filtering rules shared by the Edge extension.
 *
 * This is a local-only port of VIUK One's host matching and the lexical/SML
 * portion of AdvancedContentFilter.quickAnalyze. Network reputation checks
 * (Google Safe Browsing and TextRazor) intentionally do not belong here.
 */

export const MVP_CATEGORIES = [
  { id: "adult_content", title: "成人向けコンテンツ" },
  { id: "violence", title: "暴力" },
  { id: "inappropriate_language", title: "不適切な表現" },
  { id: "gambling", title: "ギャンブル" },
  { id: "dating", title: "出会い系" },
  { id: "drugs", title: "薬物" },
  { id: "phishing", title: "個人情報詐欺" },
  { id: "suspicious_redirect", title: "不審な誘導" },
] as const;

export type FilterCategoryId = (typeof MVP_CATEGORIES)[number]["id"];
export type FilterDecision = "allow" | "block" | "indeterminate";
export type FilterStage = "url" | "content" | "runtime";
export type FilterUncertainty = "truncated" | "uninspectable" | null;

export interface FilterInput {
  url: string;
  title: string;
  bodyText: string;
  isTruncated: boolean;
  hasUninspectableContent: boolean;
}

export interface FilterResult {
  decision: FilterDecision;
  stage: FilterStage;
  categories: FilterCategoryId[];
  reasonCode:
    | "site_rule_block"
    | "site_rule_allow"
    | "content_category_match"
    | "category_disabled"
    | "risky_tld_match"
    | "suspicious_redirect_match"
    | "content_no_match"
    | "search_context_suppressed"
    | "content_incomplete"
    | "empty_content";
  matchedKeywords: string[];
  /** Retains the fact that a block was based on only partially inspectable content. */
  uncertainty: FilterUncertainty;
}

export interface SiteRule {
  host: string;
  action: "block" | "allow";
  categoryId?: FilterCategoryId;
}

export interface EvaluateOptions {
  siteRules?: readonly SiteRule[];
  /** Missing means the backwards-compatible default: all MVP categories enabled. */
  enabledCategories?: readonly FilterCategoryId[];
  strictMode?: boolean;
}

type WeightedToken = readonly [token: string, weight: number];
type ReinforcingPair = readonly [left: string, right: string, bonus: number];

interface CategoryModel {
  bias: number;
  positiveTokens: readonly WeightedToken[];
  urlTokens: readonly WeightedToken[];
  safeContextTokens: readonly WeightedToken[];
  reinforcingPairs: readonly ReinforcingPair[];
}

interface SMLSignal {
  probability: number;
  rawScore: number;
  matchedKeywords: string[];
  dampeningKeywords: string[];
  positiveScore: number;
  negativeScore: number;
  isLikelyFalsePositive: boolean;
}

const DANGEROUS_PATTERNS: ReadonlyArray<{
  categoryId: FilterCategoryId;
  terms: readonly string[];
}> = [
  {
    categoryId: "adult_content",
    terms: [
      "アダルト", "AV", "エロ", "ポルノ", "sex", "xxx", "porn", "adult",
      "nude", "風俗", "FANZA", "セックス",
    ],
  },
  {
    categoryId: "violence",
    terms: ["暴力", "殺人", "傷害", "グロ", "死体", "殺す", "首吊り"],
  },
  {
    categoryId: "inappropriate_language",
    terms: ["死ね", "fuck", "shit", "殺", "差別", "ヘイト"],
  },
  {
    categoryId: "gambling",
    terms: [
      "カジノ", "競馬", "競輪", "競艇", "パチンコ", "賭博", "ベット",
      "オンラインカジノ",
    ],
  },
  {
    categoryId: "dating",
    terms: ["出会い系", "マッチング", "不倫", "浮気", "援助", "パパ活"],
  },
  {
    categoryId: "drugs",
    terms: ["麻薬", "覚醒剤", "大麻", "ドラッグ", "違法薬物"],
  },
  {
    categoryId: "phishing",
    terms: [
      "verify", "password", "credit card", "seed phrase", "wallet", "本人確認",
      "パスワード", "クレジットカード", "口座番号",
    ],
  },
];

const GLOBAL_SAFE_CONTEXT_TOKENS: readonly WeightedToken[] = [
  ["教育", 0.28], ["学習", 0.28], ["研究", 0.28], ["教材", 0.24], ["解説", 0.22],
  ["辞典", 0.20], ["百科", 0.20], ["対策", 0.30], ["防止", 0.30], ["予防", 0.26],
  ["被害", 0.24], ["相談", 0.24], ["ニュース", 0.22], ["報道", 0.22], ["医療", 0.25],
  ["学校", 0.20], ["授業", 0.20], ["health", 0.24], ["education", 0.28],
  ["research", 0.28], ["history", 0.22], ["wikipedia", 0.20], ["guide", 0.18],
  ["safety", 0.22],
];

// Weights and category vocabulary are ported from UltraLightSafetySML.
const SML_MODELS: Partial<Record<FilterCategoryId, CategoryModel>> = {
  adult_content: {
    bias: -2.15,
    positiveTokens: [
      ["アダルト", 1.45], ["ポルノ", 1.70], ["エロ", 1.55], ["sex", 1.10], ["xxx", 1.65],
      ["porn", 1.70], ["adult", 1.45], ["nude", 1.05], ["無修正", 1.85], ["風俗", 1.25],
      ["fanza", 1.55], ["セックス", 1.35], ["live chat", 0.90],
    ],
    urlTokens: [[".xxx", 1.45], [".adult", 1.10], ["18+", 0.85], ["/adult", 0.75]],
    safeContextTokens: [
      ["性教育", 1.45], ["保健", 0.95], ["教育", 0.90], ["学習", 0.80], ["医療", 0.80],
      ["health", 0.70], ["research", 0.72], ["ニュース", 0.52], ["被害", 0.68],
    ],
    reinforcingPairs: [
      ["adult", "live chat", 0.50], ["アダルト", "動画", 0.40], ["18+", "無料", 0.32],
    ],
  },
  violence: {
    bias: -2.20,
    positiveTokens: [
      ["暴力", 1.05], ["殺人", 1.55], ["グロ", 1.55], ["死体", 1.45], ["拷問", 1.30],
      ["銃", 1.05], ["weapon", 1.00], ["gore", 1.45], ["murder", 1.45],
    ],
    urlTokens: [["/gore", 1.00], ["/violence", 0.85]],
    safeContextTokens: [
      ["ニュース", 0.70], ["報道", 0.75], ["歴史", 0.70], ["教材", 0.60], ["防犯", 0.60],
      ["事件解説", 0.60],
    ],
    reinforcingPairs: [["殺人", "事件", 0.18], ["gore", "video", 0.45]],
  },
  inappropriate_language: {
    bias: -2.35,
    positiveTokens: [
      ["fuck", 1.10], ["shit", 1.00], ["死ね", 1.35], ["ヘイト", 1.10], ["差別", 1.05],
      ["侮辱", 0.95],
    ],
    urlTokens: [],
    safeContextTokens: [["引用", 0.55], ["ニュース", 0.52], ["教材", 0.50], ["研究", 0.55]],
    reinforcingPairs: [["差別", "ヘイト", 0.30]],
  },
  gambling: {
    bias: -2.05,
    positiveTokens: [
      ["カジノ", 1.55], ["オンラインカジノ", 1.80], ["賭博", 1.55], ["bet", 1.15],
      ["casino", 1.55], ["競馬", 1.00], ["競輪", 1.00], ["競艇", 1.00], ["パチンコ", 1.00],
      ["baccarat", 1.20], ["slot", 0.92], ["free spin", 1.10],
    ],
    urlTokens: [[".bet", 1.35], [".casino", 1.35], ["/casino", 0.85]],
    safeContextTokens: [
      ["依存", 0.95], ["対策", 0.78], ["違法", 0.95], ["規制", 0.90], ["ニュース", 0.68],
      ["相談", 0.66], ["被害", 0.66],
    ],
    reinforcingPairs: [
      ["casino", "bonus", 0.50], ["カジノ", "無料", 0.35], ["bet", "odds", 0.45],
    ],
  },
  dating: {
    bias: -2.10,
    positiveTokens: [
      ["出会い系", 1.75], ["マッチング", 0.95], ["不倫", 1.25], ["援助", 1.20], ["パパ活", 1.55],
      ["escort", 1.45], ["hookup", 1.30], ["即会い", 1.45],
    ],
    urlTokens: [["/dating", 0.95], ["match", 0.42]],
    safeContextTokens: [
      ["被害", 0.82], ["対策", 0.80], ["相談", 0.86], ["安全", 0.66], ["ニュース", 0.62],
      ["恋愛相談", 1.05], ["相性", 0.98], ["relationship", 0.72], ["advice", 0.62],
      ["パートナー", 0.62], ["カップル", 0.58], ["心理", 0.48],
    ],
    reinforcingPairs: [
      ["出会い系", "無料", 0.35], ["マッチング", "即会い", 0.65], ["escort", "private", 0.45],
    ],
  },
  drugs: {
    bias: -2.15,
    positiveTokens: [
      ["麻薬", 1.65], ["覚醒剤", 1.75], ["大麻", 1.35], ["違法薬物", 1.85], ["ドラッグ", 1.05],
      ["cocaine", 1.60], ["mdma", 1.70], ["weed", 1.10], ["たばこ", 0.90], ["喫煙", 0.85],
    ],
    urlTokens: [["/drug", 0.82], ["/weed", 0.82]],
    safeContextTokens: [
      ["医療", 1.00], ["治療", 1.00], ["依存", 0.88], ["対策", 0.78], ["教育", 0.66],
      ["保健", 0.84], ["ニュース", 0.65],
    ],
    reinforcingPairs: [["大麻", "販売", 0.48], ["cocaine", "buy", 0.60]],
  },
  phishing: {
    bias: -2.10,
    positiveTokens: [
      ["password", 1.00], ["verify", 1.05], ["wallet", 1.18], ["seed phrase", 1.80],
      ["credit card", 1.30], ["ログイン", 0.78], ["本人確認", 0.78], ["パスワード", 1.00],
      ["クレジットカード", 1.30], ["口座番号", 1.55], ["secret recovery phrase", 1.95],
    ],
    urlTokens: [["login", 0.65], ["signin", 0.65], ["verify", 0.72], ["wallet", 0.78]],
    safeContextTokens: [
      ["対策", 1.00], ["防止", 1.00], ["注意", 0.76], ["警察", 0.82], ["公式ヘルプ", 0.72],
      ["サポート", 0.44], ["news", 0.55], ["guide", 0.45],
    ],
    reinforcingPairs: [
      ["login", "password", 0.55], ["wallet", "seed phrase", 0.92],
      ["本人確認", "クレジットカード", 0.72],
    ],
  },
};

const SEARCH_PRESERVED_URL_PARTS = [
  "google.com/search",
  "google.co.jp/search",
  "bing.com/search",
  "search.yahoo.co.jp",
  "duckduckgo.com",
  "accounts.google.com",
  "myaccount.google.com",
  "login.live.com",
  "login.microsoftonline.com",
] as const;

const TECHNICAL_OR_LEARNING_TERMS = [
  "package.json", "main.swift", ".swift", ".json", ".yml", ".yaml", ".toml",
  ".gguf", "xcode", "swiftui", "swift", "github", "git", "build", "compile",
  "module", "sdk", "api", "localhost", "127.0.0.1", "readme", "documentation",
  "docs", "developer.apple.com", "huggingface", "ファイル名", "バージョン", "version",
  "チュートリアル", "教材", "学習", "手順", "サンプルコード", "ログ", "zip",
  "education", "educational", "sex education", "sexual health", "reproductive health",
] as const;

const TECHNICAL_PHISHING_SPECIFIC_TERMS = [
  "wallet", "seed phrase", "credit card", "本人確認", "口座番号",
] as const;

const EDUCATIONAL_ADULT_DATING_TERMS = [
  "相談", "支援", "授業", "学習", "安全", "対策", "research", "study",
  "education", "educational", "sex education", "sexual health", "reproductive health",
] as const;

const GENERIC_PHISHING_TERMS = ["ログイン", "login", "signin", "password", "verify"] as const;

const MIXED_RISK_PAIRS: ReadonlyArray<{
  categoryId: FilterCategoryId;
  leftWords: readonly string[];
  rightWords: readonly string[];
}> = [
  {
    categoryId: "phishing",
    leftWords: ["ログイン", "login", "signin"],
    rightWords: ["カード", "credit", "wallet", "password", "verify"],
  },
  {
    categoryId: "adult_content",
    leftWords: ["年齢確認", "18+"],
    rightWords: ["動画", "live", "chat", "無料"],
  },
];

const SUSPICIOUS_URL_FRAGMENTS = ["redirect=", "out.php?", "jump.php?", ".dmg", ".pkg", ".exe"] as const;
const RISKY_TLDS = [".xxx", ".sex", ".adult", ".bet", ".casino"] as const;

function decodePercentEscapes(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeHostname(hostname: string): string | null {
  let normalized = decodePercentEscapes(hostname)
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (normalized.startsWith("www.")) normalized = normalized.slice(4);
  return normalized || null;
}

function parseHostname(value: string): string | null {
  const input = decodePercentEscapes(value.trim()).replace(/\\/g, "/");
  if (!input) return null;

  const candidates = [input];
  const hasExplicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  if (!hasExplicitScheme) {
    candidates.push("https://" + input.replace(/^[./\s]+/, ""));
  }

  for (const candidate of candidates) {
    try {
      const hostname = new URL(candidate).hostname;
      const normalized = normalizeHostname(hostname);
      if (normalized) return normalized;
    } catch {
      // Try the scheme-less host form below, matching SafeBrowseURLPolicy's fallback.
    }
  }

  if (hasExplicitScheme) return null;

  // Preserve the source's host-part fallback for plain rules that URL cannot parse.
  const hostPart = input
    .replace(/^[./\s]+|[./\s]+$/g, "")
    .split("/", 1)[0]
    .split("?", 1)[0]
    .split("#", 1)[0];
  return normalizeHostname(hostPart);
}

/** Normalize either a URL or a rule-like host into a lowercase hostname. */
export function normalizeHost(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return parseHostname(value);
}

/** Match a host exactly or at a dot-delimited subdomain boundary. */
export function hostMatchesRule(host: string | null | undefined, rule: string): boolean {
  const normalizedHost = normalizeHost(host);
  const normalizedRule = normalizeHost(rule);
  if (!normalizedHost || !normalizedRule) return false;
  return normalizedHost === normalizedRule || normalizedHost.endsWith("." + normalizedRule);
}

function uncertaintyFor(input: FilterInput): FilterUncertainty {
  if (input.hasUninspectableContent) return "uninspectable";
  if (input.isTruncated) return "truncated";
  return null;
}

function result(
  decision: FilterDecision,
  stage: FilterStage,
  reasonCode: FilterResult["reasonCode"],
  input: FilterInput,
  categoryIds: FilterCategoryId[] = [],
  matchedKeywords: string[] = [],
): FilterResult {
  return {
    decision,
    stage,
    categories: categoryIds,
    reasonCode,
    matchedKeywords: unique(matchedKeywords),
    uncertainty: uncertaintyFor(input),
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function matchSiteRule(url: string, rules: readonly SiteRule[]): SiteRule | null {
  const host = normalizeHost(url);
  if (!host) return null;
  const matches = rules.flatMap((rule) => {
    const normalizedRule = normalizeHost(rule.host);
    if (!normalizedRule || !hostMatchesRule(host, normalizedRule)) return [];
    return [{ rule, normalizedRule, specificity: normalizedRule.split(".").length }];
  });
  matches.sort((left, right) => {
    if (left.rule.action !== right.rule.action) return left.rule.action === "allow" ? -1 : 1;
    if (left.specificity !== right.specificity) return right.specificity - left.specificity;
    if (left.normalizedRule.length !== right.normalizedRule.length) {
      return right.normalizedRule.length - left.normalizedRule.length;
    }
    return 0;
  });
  return matches[0]?.rule ?? null;
}

function isProtectedSearchPage(url: string): boolean {
  return SEARCH_PRESERVED_URL_PARTS.some((part) => url.includes(part));
}

function isTechnicalOrLearningContext(text: string, url: string): boolean {
  if (TECHNICAL_OR_LEARNING_TERMS.some((term) => text.includes(term) || url.includes(term))) return true;
  return /(?<!\d)\d+\.\d+(?:\.\d+)?(?!\d)/.test(text);
}

function shouldSuppressQuickHit(
  categoryId: FilterCategoryId,
  keywords: readonly string[],
  text: string,
  url: string,
  technicalContext: boolean,
): boolean {
  if (technicalContext) {
    if (categoryId === "phishing") {
      const hasSpecificTerm = keywords.some((keyword) =>
        TECHNICAL_PHISHING_SPECIFIC_TERMS.some((term) => keyword.toLowerCase().includes(term)),
      );
      if (!hasSpecificTerm) return true;
    }

    if (categoryId === "dating" || categoryId === "adult_content") {
      if (EDUCATIONAL_ADULT_DATING_TERMS.some((term) => text.includes(term) || url.includes(term))) {
        return true;
      }
    }
  }

  if (categoryId === "phishing") {
    const genericOnly = keywords.every((keyword) =>
      GENERIC_PHISHING_TERMS.some((term) => keyword.toLowerCase().includes(term)),
    );
    if (genericOnly) return true;
  }
  return false;
}

function normalizeSML(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function evaluateSML(
  categoryId: FilterCategoryId,
  text: string,
  url: string,
  seedKeywords: readonly string[],
): SMLSignal | null {
  const model = SML_MODELS[categoryId];
  if (!model) return null;

  const normalizedText = normalizeSML(text);
  const normalizedURL = normalizeSML(url);
  const combined = normalizedURL + " " + normalizedText;
  let rawScore = model.bias;
  let positiveScore = 0;
  let negativeScore = 0;
  const matchedKeywords = new Set<string>();
  const dampeningKeywords = new Set<string>();

  for (const [token, weight] of model.positiveTokens) {
    if (!combined.includes(token.toLowerCase())) continue;
    rawScore += weight;
    positiveScore += weight;
    matchedKeywords.add(token);
  }

  for (const [token, weight] of model.urlTokens) {
    if (!normalizedURL.includes(token.toLowerCase())) continue;
    rawScore += weight;
    positiveScore += weight;
    matchedKeywords.add(token);
  }

  for (const keyword of new Set(seedKeywords.map((value) => value.toLowerCase()))) {
    if (!keyword || !combined.includes(keyword)) continue;
    rawScore += 0.18;
    positiveScore += 0.18;
    matchedKeywords.add(keyword);
  }

  for (const [token, weight] of model.safeContextTokens) {
    if (!combined.includes(token.toLowerCase())) continue;
    rawScore -= weight;
    negativeScore += weight;
    dampeningKeywords.add(token);
  }

  for (const [token, weight] of GLOBAL_SAFE_CONTEXT_TOKENS) {
    if (!combined.includes(token.toLowerCase())) continue;
    rawScore -= weight;
    negativeScore += weight;
    dampeningKeywords.add(token);
  }

  for (const [left, right, bonus] of model.reinforcingPairs) {
    if (!combined.includes(left.toLowerCase()) || !combined.includes(right.toLowerCase())) continue;
    rawScore += bonus;
    positiveScore += bonus;
  }

  if (matchedKeywords.size === 0) return null;
  if (matchedKeywords.size === 1 && positiveScore < 1.9) {
    rawScore -= 0.35;
  } else if (matchedKeywords.size >= 3) {
    rawScore += 0.24;
    positiveScore += 0.24;
  }
  if (dampeningKeywords.size >= 2) {
    rawScore -= 0.28;
    negativeScore += 0.28;
  }

  const probability = sigmoid(rawScore);
  if (probability < 0.34) return null;
  const matched = [...matchedKeywords].sort();
  const dampening = [...dampeningKeywords].sort();
  const dampeningDominant = negativeScore >= Math.max(positiveScore * 0.66, 0.95);
  const weakRiskContext = matched.length <= 2 || positiveScore < 2.4;
  const isLikelyFalsePositive = dampeningDominant && weakRiskContext && probability < 0.90;

  return {
    probability,
    rawScore,
    matchedKeywords: matched,
    dampeningKeywords: dampening,
    positiveScore,
    negativeScore,
    isLikelyFalsePositive,
  };
}

function quickBlockThreshold(strictMode: boolean): number {
  return strictMode ? 0.70 : 0.78;
}

function shouldBlockQuickCandidate(
  signal: SMLSignal | null,
  urlHit: boolean,
  textHit: boolean,
  combinedHitCount: number,
  strictMode: boolean,
): boolean {
  if (!signal) {
    if (urlHit) return combinedHitCount >= 2;
    if (textHit) return strictMode ? combinedHitCount >= 3 : combinedHitCount >= 4;
    return false;
  }
  if (signal.isLikelyFalsePositive) return false;

  const threshold = quickBlockThreshold(strictMode);
  if (urlHit && signal.probability >= threshold - 0.08) return true;
  if (textHit && combinedHitCount >= 3 && signal.probability >= threshold) return true;
  if (strictMode && textHit && combinedHitCount >= 2 && signal.probability >= 0.82) return true;
  return combinedHitCount >= 2 && signal.probability >= 0.90;
}

function mergeSMLKeywords(primary: readonly string[], signal: SMLSignal | null): string[] {
  return unique([...primary, ...(signal?.matchedKeywords ?? [])]).sort();
}

function categoryMatch(
  categoryId: FilterCategoryId,
  keywords: readonly string[],
  text: string,
  url: string,
  technicalContext: boolean,
  strictMode: boolean,
  urlHit: boolean,
  textHit: boolean,
): string[] | null {
  if (shouldSuppressQuickHit(categoryId, keywords, text, url, technicalContext)) return null;
  const signal = evaluateSML(categoryId, text, url, keywords);
  if (!shouldBlockQuickCandidate(signal, urlHit, textHit, keywords.length, strictMode)) return null;
  return mergeSMLKeywords(keywords, signal);
}

function detectContentBlock(
  text: string,
  url: string,
  strictMode: boolean,
  enabledCategories?: ReadonlySet<FilterCategoryId>,
): { categoryId: FilterCategoryId; reasonCode: FilterResult["reasonCode"]; keywords: string[] } | null {
  const textSnippet = text.slice(0, 1200);
  // Preserve search-result pages by URL. Authentication words often appear in
  // navigation on risky sites, so they must not suppress unrelated categories.
  if (isProtectedSearchPage(url)) return null;
  const technicalContext = isTechnicalOrLearningContext(textSnippet, url);

  for (const category of DANGEROUS_PATTERNS) {
    if (enabledCategories && !enabledCategories.has(category.categoryId)) continue;
    const terms = category.terms;
    const urlMatches = terms.filter((term) => url.includes(term.toLowerCase()));
    const textMatches = terms.filter((term) => textSnippet.includes(term.toLowerCase()));
    const mergedMatches = unique([...urlMatches, ...textMatches]);
    if (mergedMatches.length === 0) continue;
    const matched = categoryMatch(
      category.categoryId,
      mergedMatches,
      textSnippet,
      url,
      technicalContext,
      strictMode,
      urlMatches.length > 0,
      textMatches.length > 0,
    );
    if (matched) return { categoryId: category.categoryId, reasonCode: "content_category_match", keywords: matched };
  }

  if (strictMode) {
    const downloadHits = SUSPICIOUS_URL_FRAGMENTS.filter((fragment) =>
      fragment.startsWith(".") ? url.endsWith(fragment) : url.includes(fragment),
    );
    if (
      (!enabledCategories || enabledCategories.has("suspicious_redirect")) &&
      !technicalContext &&
      downloadHits.length > 0
    ) {
      return {
        categoryId: "suspicious_redirect",
        reasonCode: "suspicious_redirect_match",
        keywords: [...downloadHits],
      };
    }
    if (
      (!enabledCategories || enabledCategories.has("suspicious_redirect")) &&
      !technicalContext &&
      url.endsWith(".zip") &&
      url.includes("redirect")
    ) {
      return {
        categoryId: "suspicious_redirect",
        reasonCode: "suspicious_redirect_match",
        keywords: [".zip", "redirect"],
      };
    }
  }

  for (const pair of MIXED_RISK_PAIRS) {
    if (enabledCategories && !enabledCategories.has(pair.categoryId)) continue;
    const leftHits = pair.leftWords.filter((word) => textSnippet.includes(word.toLowerCase()) || url.includes(word.toLowerCase()));
    const rightHits = pair.rightWords.filter((word) => textSnippet.includes(word.toLowerCase()) || url.includes(word.toLowerCase()));
    if (leftHits.length === 0 || rightHits.length === 0) continue;
    const merged = unique([...leftHits, ...rightHits]);
    if (shouldSuppressQuickHit(pair.categoryId, merged, textSnippet, url, technicalContext)) continue;
    const signal = evaluateSML(pair.categoryId, textSnippet, url, merged);
    if (signal && signal.probability >= quickBlockThreshold(strictMode) && !signal.isLikelyFalsePositive) {
      return {
        categoryId: pair.categoryId,
        reasonCode: "content_category_match",
        keywords: mergeSMLKeywords(merged, signal),
      };
    }
  }

  if (strictMode) {
    const tldHits = RISKY_TLDS.filter((tld) => url.includes(tld));
    if (tldHits.length > 0) {
      const categoryId: FilterCategoryId = tldHits.some((tld) => tld === ".bet" || tld === ".casino")
        ? "gambling"
        : "adult_content";
      if (!enabledCategories || enabledCategories.has(categoryId)) {
        return { categoryId, reasonCode: "risky_tld_match", keywords: [...tldHits] };
      }
    }
  }

  for (const category of DANGEROUS_PATTERNS) {
    if (enabledCategories && !enabledCategories.has(category.categoryId)) continue;
    const urlMatches = category.terms.filter((term) => url.includes(term.toLowerCase()));
    if (urlMatches.length < 2) continue;
    if (shouldSuppressQuickHit(category.categoryId, urlMatches, textSnippet, url, technicalContext)) continue;
    const signal = evaluateSML(category.categoryId, textSnippet, url, urlMatches);
    if (signal && signal.probability >= 0.84 && !signal.isLikelyFalsePositive) {
      return {
        categoryId: category.categoryId,
        reasonCode: "content_category_match",
        keywords: mergeSMLKeywords(urlMatches, signal),
      };
    }
  }
  return null;
}

/**
 * Evaluate a URL rule first, then the local lexical/SML body classifier.
 * No network requests, browser APIs, timers, or mutable global state are used.
 */
export function evaluatePage(
  input: FilterInput,
  options: EvaluateOptions = {},
): FilterResult {
  const siteRule = matchSiteRule(input.url, options.siteRules ?? []);
  if (siteRule) {
    const categoryIds = siteRule.action === "block" && siteRule.categoryId ? [siteRule.categoryId] : [];
    return result(
      siteRule.action,
      "url",
      siteRule.action === "block" ? "site_rule_block" : "site_rule_allow",
      input,
      categoryIds,
      [normalizeHost(siteRule.host) ?? siteRule.host],
    );
  }

  const text = (input.title + " " + input.bodyText).toLowerCase();
  const textSnippet = text.slice(0, 1200);
  const hasText = textSnippet.trim().length > 0;
  const uncertainty = uncertaintyFor(input);
  if (!hasText) {
    return result(
      "indeterminate",
      "runtime",
      uncertainty ? "content_incomplete" : "empty_content",
      input,
    );
  }

  const normalizedURL = input.url.toLowerCase();
  const strictMode = options.strictMode ?? false;
  const enabledCategories = options.enabledCategories === undefined
    ? undefined
    : new Set(options.enabledCategories);
  const block = detectContentBlock(text, normalizedURL, strictMode, enabledCategories);
  if (block) {
    return result(
      "block",
      "content",
      block.reasonCode,
      input,
      [block.categoryId],
      block.keywords,
    );
  }

  if (enabledCategories) {
    // If a disabled category matched but no enabled category did, report the
    // skipped candidate separately. Partial or uninspectable pages still fail
    // closed because unobserved text may contain an enabled category.
    const disabledBlock = detectContentBlock(text, normalizedURL, strictMode);
    if (disabledBlock) {
      if (uncertainty) {
        return result("indeterminate", "runtime", "content_incomplete", input);
      }
      return result(
        "allow",
        "content",
        "category_disabled",
        input,
        [disabledBlock.categoryId],
        disabledBlock.keywords,
      );
    }
  }

  if (uncertainty) {
    return result("indeterminate", "runtime", "content_incomplete", input);
  }

  return result(
    "allow",
    "content",
    isProtectedSearchPage(input.url.toLowerCase())
      ? "search_context_suppressed"
      : "content_no_match",
    input,
  );
}
