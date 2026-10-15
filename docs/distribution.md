# ブラウザー拡張の配布手順

確認日: 2026-10-15

このリポジトリは現在、Chromium系ブラウザー向けのManifest V3拡張を配布します。EdgeとChromeのパッケージは同じ `dist/edge` ビルドから作成します。EdgeはmacOS上で実動作を確認済みです。Chromeは同じAPI構成を使えますが、Chrome実機での動作確認はまだ行っていません。

## 1. ローカルでの試用

ストアへ提出せず、開発者モードで読み込む場合は、先にビルドします。

```sh
npm ci
npm run build
```

- **Microsoft Edge:** `edge://extensions` を開き、開発者モードを有効にして「展開して読み込み」から `dist/edge` を選びます。
- **Google Chrome:** `chrome://extensions` を開き、デベロッパーモードを有効にして「パッケージ化されていない拡張機能を読み込む」から同じ `dist/edge` を選びます。

ローカル読み込みは、その端末の試用です。ほかの利用者へ配るには各ストアで公開するか、管理対象端末向けの配布方法を使います。

## 2. ストア提出用ZIPを作る

```sh
npm run package:edge
npm run package:chrome
```

出力先は次のとおりです。

- Edge Add-ons: `release/x-filtering-system-edge-<version>.zip`
- Chrome Web Store: `release/x-filtering-system-chrome-<version>.zip`

現行バージョンは `0.1.0` です。ZIP名のバージョンはビルド済み `manifest.json` から自動で取得するため、更新時は拡張マニフェストの `version` を上げて作り直します。両方とも同一のChromium向けビルドで、ZIPのルートに `manifest.json` と拡張の必要ファイルが入ります。ビルドは `chrome120` をターゲットにしています。Chromeでの実動作を確認してからストア提出してください。

## 3. Microsoft Edge Add-onsへ提出

1. Microsoft Partner CenterでEdge拡張開発者アカウントを準備します。
2. 「新しい拡張機能」を作り、`release/x-filtering-system-edge-<version>.zip` をアップロードします。
3. **Availability**で公開範囲と市場を設定します。検索・一覧に出さず、掲載URLを案内する場合は `Hidden` を選びます。`Hidden` はURLを知る人に向けた掲載方法で、テスターを指定する非公開配布ではありません。
4. **Properties**でカテゴリ、開発元情報、サポート先を設定します。
5. **Privacy**で単一目的、各権限の理由、データの扱い、リモートコード利用の有無を実装と一致させて申告します。
6. **Store listings**で言語ごとの説明とロゴを登録します。説明文は250〜10,000文字が必要です。ロゴは1:1で、最小128×128px、推奨300×300pxです。必要に応じてスクリーンショットも登録します。
7. 認証メモを記入して提出し、Partner Centerで審査状態を確認します。審査に通るまではストアから配布されません。

パッケージを更新する場合は `manifest.json` の `version` を上げ、ZIPを作り直してPartner Centerへ再提出します。Edge Add-onsは `.zip` を受け付けます。ストア登録用の説明文、各言語のロゴ、スクリーンショットはパッケージZIPとは別に準備します。現在のアイコンは128×128pxで、Edgeのロゴ要件の最小サイズに合いますが、推奨される300×300pxの登録画像は別途用意してください。

## 4. Chrome Web Storeへ提出

1. Chrome Web Storeのデベロッパーアカウントを準備し、Chrome Developer Dashboardを開きます。
2. **Add new item**から `release/x-filtering-system-chrome-<version>.zip` をアップロードします。
3. **Store Listing**に説明、アイコン、必要な画像などを登録します。
4. **Privacy**で単一目的、権限、データ収集・利用を申告します。HTTP/HTTPSのページを読むこと、本文を端末内で処理すること、外部の分類APIへ送らないことを実装どおり記載します。
5. **Distribution**で公開先と公開範囲を設定します。`Public` は一般公開、`Unlisted` は掲載URLを知る人向け、`Private` は指定したテスター向けです。どの公開範囲でも審査があります。
6. 提出し、Dashboardで審査結果と公開状態を確認します。

ZIPアップロード後はマニフェストの項目をDashboard上で編集できないため、名前・説明・アイコンを事前に確認してください。更新では `manifest.json` の `version` を上げて新しいZIPを提出します。更新も再審査の対象です。

## 5. 他ブラウザーの扱い

| ブラウザー | 現在の配布経路 | このリポジトリの状態 |
|---|---|---|
| Microsoft Edge | Edge Add-ons、またはローカル読み込み | macOS Edgeで動作確認済み。Windows実機は未確認。 |
| Google Chrome | Chrome Web Store、またはローカル読み込み | 同じChromium ZIPを用意。Chrome実機テストは未実施。 |
| Brave | Chrome Web Store経由で導入可能 | Chromium互換として候補。個別テストは未実施。 |
| Firefox | Firefox Add-ons | 同じZIPは未対応。FirefoxではManifest V3の `background.service_worker` が未サポートのため、別のbackground構成とDNR挙動の検証が必要です。 |
| Safari | Safari Web Extension | 同じZIPを直接配布できません。Safari用拡張をmacOS/iOSアプリにパッケージし、App Store Connect経由で審査・配布するか、macOS用にDeveloper ID署名とnotarizationを行います。AppleのWeb Extension PackagerまたはXcode converterを使う方法があります。移植は別作業です。 |

BraveはChromium互換拡張の多くを利用できますが、この拡張をBraveで試験した結果ではありません。FirefoxやSafariも、manifestやAPIの差を移植・試験してから対応ブラウザーとして案内します。

## 6. 提出時に説明する権限とデータの扱い

現行拡張はHTTP/HTTPSページのURL、タイトル、読み取り可能なページ内容をローカルで調べます。ホスト別ルールとカテゴリ設定は `chrome.storage.local` に保存します。ページのURLや内容を分類APIへ送信しません。一方、`http://*/*` と `https://*/*` のホスト権限を使うため、ストアの権限説明とプライバシー申告にはこの範囲を正確に記載してください。プライバシーポリシーの要否はストアの現行ルールと実際のデータ取扱いに従って判断します。

GitHubリポジトリを非公開にする設定と、ストアでの公開範囲は別の設定です。Edgeの `Hidden`、Chromeの `Unlisted` はURLを知る人へ案内する方式で、テスターを指定する `Private` とは異なります。

## 公式手順

- [Microsoft Edge拡張の公開手順](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- [Microsoft Edge拡張の更新手順](https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/update-extension)
- [Chrome Web Storeへの公開](https://developer.chrome.com/docs/webstore/publish)
- [Chrome Web Store用の準備](https://developer.chrome.com/docs/webstore/prepare)
- [Chrome Web Storeの公開範囲](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
- [Firefox Manifest V3 backgroundの互換性](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
- [Braveでの拡張機能の利用](https://support.brave.com/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave)
- [Safari Web Extensionの配布](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)
- [Safari Web ExtensionのApp Store Connectパッケージ](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect)
