# X-filtering system

SafeSearch 4 is the next generation of SafeKids Search 3. This repository starts a browser-independent local filtering core and a small Microsoft Edge Manifest V3 extension for macOS and Windows.

## What is in the MVP

- A shared TypeScript core that returns an allow, block, or indeterminate result with a stage, category IDs, and a reason code.
- An Edge extension that applies explicit site rules before top-level navigation, checks page text locally, and displays a reason and category on its block page.
- Parent settings to enable or disable automatic filtering by supported category; all MVP categories start enabled.
- No page text is sent to Google Safe Browsing, TextRazor, or another remote classification service. Those integrations are intentionally outside the local decision path.

The first release is a prototype. Its local weighted-token rules are a small port of VIUK-One's offline filtering behavior; they are not a claim of coverage equivalent to the full iOS app or to SafeSearch 4's E5 model.

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
```

Load the unpacked extension in Microsoft Edge by opening `edge://extensions`, enabling Developer mode, and selecting `dist/edge` with **Load unpacked**. Open the extension's options page to add a blocked or allowed host rule. A reserved `.invalid` host can be used for a local navigation smoke test without contacting a real website. The small local browser fixtures are in `test-fixtures/browser/`.

In the options page, **制限するカテゴリ** controls the automatic URL/body category checks. All categories are enabled by default. Explicit per-host allow/block rules remain separate and take precedence over those category toggles.

The content script analyzes readable main-frame text. A page with visible text and ordinary images is still evaluated from its readable text; a media-only page with no inspectable text is indeterminate and fails closed with a separate reason. Iframes and image pixels are not classified by this MVP.

Build the Edge Add-ons upload archive with:

```sh
npm run package:edge
```

The archive is written to `release/`. The extension requests access to HTTP and HTTPS pages so its content script can inspect them. The browser enforces explicit domain rules through Manifest V3 `declarativeNetRequest`; the page-text decision runs locally in the content script. Only top-level navigations are covered by the initial DNR rules.

## Platform, permissions, and privacy

Microsoft Edge's supported-API table lists `declarativeNetRequest` for macOS and Windows. The content script runs at `document_start`, before the page DOM is constructed. The Edge Add-ons upload format is a ZIP, which this repository builds under `release/`. Store submission still requires Partner Center listing fields and assets, including a localized description and extension logo.

The extension reads the current URL, title, and readable main-frame text on HTTP/HTTPS pages. It stores only the site rules a parent enters in `chrome.storage.local`; this prototype does not transmit page content or URLs to a classification service. The wide host permission is required for automatic filtering on pages the user visits, and the options page states that page text is checked locally.

References: [Edge API support](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support), [content scripts and `document_start`](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), and [publishing an Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension).

## Shared decision contract

`FilterInput` contains the URL, title, visible page text, and flags for truncation or uninspectable content. `FilterResult` contains:

- `decision`: `allow`, `block`, or `indeterminate`
- `stage`: `url`, `content`, or `runtime`
- `categories`: stable category IDs, empty when no category can be attributed
- `reasonCode`: stable machine-readable cause, including `category_disabled` when a matched category is disabled in parent settings
- `uncertainty`: an optional note such as `truncated` or `uninspectable`, kept separate from a category block

Both the browser integration and runtime-comparison fixtures use this contract. A page that cannot be inspected is shown as indeterminate with a reason; it is not reported as a category match.

## Model portability work

See [the model runtime evaluation](docs/model-runtime-evaluation.md) for the pinned multilingual E5 source, Core ML artifact format, tokenizer and preprocessing, input/output tensors, license notices, and measured ONNX Runtime comparisons. The MVP extension does not bundle a converted model.

## Benchmark use

The existing common benchmark remains in the SafeSearch 4 repository and is consumed read-only. Its URL, saved-HTML, and unknown-HTML cohorts must be reported separately. See [benchmark method](docs/benchmark-method.md) for the result fields and acquisition boundaries.

## License

The new filtering core and extension code in this repository are MIT-licensed. Model weights, tokenizer packages, and benchmark data retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
