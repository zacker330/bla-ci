# BLA hardening in Electron CI

**English** | [简体中文](README.zh-CN.md)

[![Electron BLA CI](https://github.com/zacker330/bla-ci/actions/workflows/ci.yml/badge.svg)](https://github.com/zacker330/bla-ci/actions/workflows/ci.yml)

A small Electron application that you can run, package, harden with [BLA](https://github.com/qybaihe/bla), and test on Linux, Windows, and macOS. The quote calculator sends calculations through preload and IPC to the main process. CI builds an original `app.asar` and a hardened version, packages both, and runs the same desktop tests against each.

## Run locally

Install Node.js 24 and npm. Linux desktop tests also need Xvfb and Electron's system dependencies.

```sh
git clone https://github.com/zacker330/bla-ci.git
cd bla-ci
npm ci
npm start
```

The application starts in **English** on every launch. Use the **Language** selector to switch to **中文**. Switching languages preserves your inputs and calculated results, and translates any visible validation error. The interface, window title, accessible labels, and validation messages support both languages. Language selection is not persisted between launches.

Amounts always use **CNY**, regardless of the interface language. Enter a unit price with at most two decimal places, a quantity from 1 to 10000, and an integer discount from 0 to 100. Calculations use integer cents and round the final payable amount to the nearest cent. The default `19.90 × 3` with a `10%` discount produces `53.73` yuan.

## Test the complete pipeline

macOS / Windows:

```sh
npm run ci
```

Ubuntu:

```sh
npx playwright install-deps chromium
xvfb-run -a npm run ci
```

Playwright uses the application's Electron runtime; a separate Chromium browser download is not required.

| Command | Purpose |
| --- | --- |
| `npm test` | Run 7 unit tests for main-process calculation and validation |
| `npm run build` | Create ASARs, harden and verify with BLA, package both apps, check artifacts, and archive the hardened app |
| `npm run test:e2e` | Run 12 desktop tests against the built original and hardened applications, covering both languages |
| `npm run ci` | Run all three steps in sequence |

## Where hardening belongs

```text
app/ → application file allowlist → original app.asar
                                          │
                                          ├── BLA audit
                                          └── BLA protect → hardened app.asar
                                                                  │
                                                             BLA verify
                                                                  │
original / hardened ASAR → Packager prebuiltAsar → two desktop applications
                                                                  │
                                                    same Playwright test suite
                                                                  │
                                                    upload tested hardened app
```

[`scripts/build.mjs`](scripts/build.mjs) runs the locally installed BLA CLI. Its commands are equivalent to:

```sh
npx --no-install bla audit dist/asar/original/app.asar --json
npx --no-install bla protect dist/asar/original/app.asar \
  -o dist/asar/hardened/app.asar \
  --intensity bankrupt --seed bla-ci-demo-v1 --json
npx --no-install bla verify dist/asar/hardened/app.asar \
  dist/asar/original/app.asar --json
```

Use `npm run build` for a complete build. BLA refuses to overwrite existing output; the script clears this project's `dist/` and regenerates both ASARs from the original application. The fixed seed makes the example reproducible; it is not a secret or an authentication mechanism.

Packager loads the final archive through [`prebuiltAsar`](https://electron.github.io/packager/main/interfaces/Options.html#prebuiltasar), then calculates integrity metadata from those bytes. This mode skips the normal application copy and dependency-pruning stages, so staging uses an explicit file allowlist. Tests and build tools are not included in the ASAR.

For an existing product, keep the order **final ASAR → integrity metadata → platform signing → notarization / installer**. Replacing the ASAR after packaging or signing can invalidate existing integrity records or signatures.

## What the tests verify

- The original and hardened applications pass the same English and Chinese calculation and validation scenarios, including half-cent rounding, direct IPC validation, and error recovery.
- The application starts in English. Changing language preserves inputs and results and translates an already-visible error.
- Tests launch the packaged executable from a temporary working directory, checking `app.isPackaged`, the actual ASAR path, and its SHA-256.
- Tests check context isolation, the renderer's sandbox configuration, disabled Node integration, and the preload bridge. Playwright adds `--no-sandbox` by default on Linux, so the Linux E2E run does not establish that the operating-system-level Chromium sandbox is active.
- Artifact checks verify application resources, JS transformation, and the ASAR header amplification produced by the pinned `bankrupt` preset.

The main process returns language-neutral error codes such as `INVALID_QUANTITY`. The renderer maps these codes to the selected language; calculation rules do not depend on the UI language.

`bla verify` reports BLA's own static simulation. It does not start this application, and its `functionalIntegrityVerified` field does not replace desktop regression testing. Token and cost multipliers are BLA estimates. This repository does not run real REA or a complete AI cracking experiment; passing tests establish the application behaviors and packaging checks covered here.

## Build output and downloads

| Location | Contents |
| --- | --- |
| `dist/asar/` | Original and hardened ASARs |
| `dist/packages/` | Both runnable desktop applications |
| `dist/reports/` | BLA JSON reports and stderr |
| `dist/build.json` | Versions, platform, architecture, seed, sizes, hashes, and build timings |
| `dist/artifacts/` | Hardened application `.tar.gz` and SHA-256 file |
| `playwright-report/` | HTML test report |
| `test-results/` | JUnit results, failure screenshots, logs, and traces |

Open a successful [Actions run](https://github.com/zacker330/bla-ci/actions/workflows/ci.yml) and download the appropriate `app-*` artifact. Extract GitHub's outer ZIP, then extract the `.tar.gz` inside it. The tar archive preserves executable permissions and macOS application symlinks. Diagnostic artifacts are separate. Both are retained for 7 days.

These application archives are CI examples without product distribution certificates or notarization. Your operating system may identify them as unverified; production distribution needs your own signing and notarization process.

## CI platforms and cost

The public repository uses standard GitHub-hosted `ubuntu-24.04`, `windows-2025`, and `macos-15` runners, building for each runner's native architecture. Standard runner compute is free in public repositories. See [GitHub's billing documentation](https://docs.github.com/en/actions/concepts/billing-and-usage).

The job requires `github.event.repository.private == false`. The entire matrix skips if the repository becomes private, avoiding accidental use of private-repository compute allowances. No `-large` or `-xlarge` runners are used.

Dependencies and Actions are pinned. The application has no runtime npm dependencies. BLA `3.0.1` at `bankrupt` intensity substantially increases the ASAR header size; inspect the current `dist/build.json` for the actual sizes and timings. Re-run all platforms after upgrading BLA, Electron, or packaging tools.
