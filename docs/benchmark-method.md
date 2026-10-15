# Common benchmark method

Use the existing common benchmark from the SafeSearch 4 checkout read-only. Do not copy its runner, datasets, reports, or captured page content into this product repository.

Keep the following cohorts distinct:

- **Known URL cases:** exercise the URL gate. Do not fetch a block-labeled destination merely to test URL matching.
- **Saved HTML:** serve the reviewed capture locally through Edge and exercise page-text collection and classification.
- **Unknown HTML:** use the held-out unknown cohort or synthetic unknown pages as labeled in the source dataset. Do not relabel failed acquisition as an allow or block.

For each case record the dataset/case ID and fingerprint, expected label/category, observed URL-gate result, observed content result, displayed reason/category, false block, supported-category coverage, unsupported category, and `unobservable` or acquisition/runtime failure. Report URL and content stages separately. Exclude unobservable cases from accuracy denominators and retain their counts. If an external reputation or classification service is evaluated later, report it in a separate result column and run profile.

The common benchmark's small cohorts are prototype evidence, not a prevalence estimate. Recheck source licenses and live-page availability before publishing new data or reproducing results.

## Mac Edge smoke results (2026-10-14)

This is a small end-to-end smoke run, not a full execution of the 563-case profile. It ran in Microsoft Edge 155.0.4283.45 (arm64) on macOS 27.0.1. The cases below were read from the SafeSearch 4 `filtering-basic-v1` source and its verified local captures; no live benchmark URL was opened and no HTML, runner, or dataset was copied into this repository. Saved pages were served on loopback with a Content Security Policy that blocked scripts, frames, media, and all network connections.

| Input | Expected label | Edge observation | Accounting |
| --- | --- | --- | --- |
| Test-only DNR host rule on `example.com` | URL smoke test | Redirected before network load; URL-stage `block`, category `adult_content`, reason `site_rule_block` | DNR API path only; not a benchmark accuracy case |
| `safe.html` fixture | Allow | Displayed | Synthetic safe control |
| `category-marker.html` fixture | Block | Content-stage `block`, category `adult_content`, reason `content_category_match` | Synthetic unknown HTML |
| `media-only.html` fixture | No category available | `indeterminate`, no category, reason `content_incomplete`, uncertainty `uninspectable` | Synthetic unknown HTML; not scored as allow or category block |
| `fb1-url-adult_sexual-001` saved capture | Block, `adult_sexual` | Content-stage `block`, category `adult_content`, reason `content_category_match` | Supported-category body check; the capture's source URL was not opened |
| `fb1-url-sexual_health_education-008` saved capture | Block, `sexual_health_education` | Allowed with no category | Category unsupported by this MVP; report separately from supported-category accuracy |
| `fb1-url-site_shopping-006` saved capture | Block, `site_shopping` | Allowed with no category | Category unsupported by this MVP; report separately from supported-category accuracy |

The two unsupported cases are expected-block misses under the benchmark labels, but the MVP has no `sexual_health_education` or `site_shopping` category. Keep them visible in unsupported-category coverage rather than calling them false blocks or silently counting them as supported-category successes. This sample does not establish full-profile accuracy. These summaries derive from the `filtering-basic-v1` profile in SafeSearch 4's `filtering-benchmark/data`, attributed to Filtering Benchmark contributors. Its URL annotations and metadata are [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); source domain lists retain their own licenses, and saved site HTML remains excluded from this repository and subject to each site's rights.
