# Electron CI 接入 BLA

[English](README.md) | **简体中文**

[![Electron BLA CI](https://github.com/zacker330/bla-ci/actions/workflows/ci.yml/badge.svg)](https://github.com/zacker330/bla-ci/actions/workflows/ci.yml)

一个可以本地运行、打包并自动测试的 Electron 示例。应用是报价计算器，业务计算通过 preload 和 IPC 进入主进程。构建时先生成原始 `app.asar`，再用 [BLA](https://github.com/qybaihe/bla) 生成加固版本，最后分别打包并执行同一套桌面测试。

## 本地运行

需要 Node.js 24 和 npm；Linux 桌面测试还需要 Xvfb 及 Electron 的系统依赖。

```sh
git clone https://github.com/zacker330/bla-ci.git
cd bla-ci
npm ci
npm start
```

应用每次启动默认显示英文，可通过右上角 **Language** 选择 **中文**。切换语言会保留输入和计算结果，并翻译当前显示的错误提示。界面、窗口标题、无障碍标签和校验提示均支持中英文，语言选择不跨启动保存。

金额始终使用人民币，切换语言不会切换币种。单价按元输入，最多两位小数；数量为 1 至 10000 的整数；优惠比例为 0 至 100 的整数。计算使用整数分，最终应付金额四舍五入至分。默认输入 `19.90 × 3`、优惠 `10%`，应付 `53.73` 元。

## 验证完整链路

macOS / Windows：

```sh
npm run ci
```

Ubuntu：

```sh
npx playwright install-deps chromium
xvfb-run -a npm run ci
```

Playwright 使用应用内的 Electron，不需要另外下载 Chromium 浏览器。各命令也可以单独执行：

| 命令 | 内容 |
| --- | --- |
| `npm test` | 主进程计算逻辑的 7 个单元测试 |
| `npm run build` | ASAR 打包、BLA 加固和验证、两份桌面应用打包、产物检查和归档 |
| `npm run test:e2e` | 对原始应用与加固应用共运行 12 个桌面测试，覆盖中英文 |
| `npm run ci` | 按顺序运行上述三步 |

## 加固放在哪里

```text
app/ → 应用文件白名单 → 原始 app.asar
                           │
                           ├── BLA audit
                           └── BLA protect → 加固 app.asar
                                               │
                                          BLA verify
                                               │
原始 ASAR / 加固 ASAR → Packager prebuiltAsar → 两份桌面应用
                                               │
                                      同一套 Playwright 测试
                                               │
                                      上传已测试的加固应用
```

构建入口是 [`scripts/build.mjs`](scripts/build.mjs)。BLA 通过本地依赖的 CLI 运行，命令等价于：

```sh
npx --no-install bla audit dist/asar/original/app.asar --json
npx --no-install bla protect dist/asar/original/app.asar \
  -o dist/asar/hardened/app.asar \
  --intensity bankrupt --seed bla-ci-demo-v1 --json
npx --no-install bla verify dist/asar/hardened/app.asar \
  dist/asar/original/app.asar --json
```

这些命令用于解释构建过程；正常使用直接执行 `npm run build`。BLA 会拒绝覆盖已有输出，构建脚本每次先清理本项目的 `dist/`，重新从原始应用生成两份 ASAR。固定 seed 用于复现实验，不承担保密或身份认证功能。

加固后的 ASAR 通过 Packager 的 [`prebuiltAsar`](https://electron.github.io/packager/main/interfaces/Options.html#prebuiltasar) 装入应用。Packager 从这份最终 ASAR 计算完整性信息，再进入后续平台处理。此模式会跳过常规复制和依赖裁剪，因此输入目录明确只包含应用文件，开发依赖和测试不会进入 ASAR。

集成到已有产品时，保持“最终 ASAR → 完整性元数据 → 平台签名 → 公证/安装器”的顺序。构建完成后再直接替换 ASAR，可能使已有完整性记录或平台签名失效。

## 测试检查了什么

- 原始包和加固包执行相同的中英文用例，覆盖正常报价、半分舍入、非法输入、直接 IPC 校验与错误恢复。
- 检查默认英文，以及切换语言后保留输入与结果、翻译当前错误提示的行为。
- 从打包后的可执行文件启动应用，并把工作目录改到临时目录，检查 `app.isPackaged`、实际 `app.asar` 路径及 SHA-256。
- 检查上下文隔离、renderer sandbox 配置值和关闭 Node 集成后的运行情况，确认 preload 桥接存在。Playwright 在 Linux 默认追加 `--no-sandbox`，因此该 Linux E2E 运行不证明操作系统级 Chromium 沙箱已经启用。
- 检查加固前后真正的应用资源、JS 转换和 `bankrupt` 预设的 ASAR header 膨胀。

主进程返回 `INVALID_QUANTITY` 等与语言无关的错误码，由 renderer 根据当前语言显示提示，计算规则不随界面语言改变。

`bla verify` 的 `overallPassed` 是上游静态模拟的结果；它没有启动此应用。其 `functionalIntegrityVerified` 字段也不能替代桌面回归测试。报告中的 token / 费用放大倍数来自 BLA 的估算。本仓库没有运行真实 REA 或完整 AI 破解实验，测试通过说明这里覆盖的应用行为和打包流程正常。

## 输出和下载

| 位置 | 内容 |
| --- | --- |
| `dist/asar/` | 原始和加固 ASAR |
| `dist/packages/` | 两份可运行桌面应用 |
| `dist/reports/` | BLA JSON 报告及 stderr |
| `dist/build.json` | 版本、平台、架构、seed、文件大小、哈希和构建阶段耗时 |
| `dist/artifacts/` | 加固应用的 `.tar.gz` 与 SHA-256 文件 |
| `playwright-report/` | HTML 测试报告 |
| `test-results/` | JUnit、失败截图、日志及 trace |

在 [Actions](https://github.com/zacker330/bla-ci/actions/workflows/ci.yml) 中选择成功运行，下载对应系统的 `app-*` artifact，解压 GitHub 的外层 ZIP 后再解开 `.tar.gz`。Linux/macOS 的可执行权限与应用内符号链接由 tar 保留。诊断 artifact 单独保存；保留期均为 7 天。

应用归档用于 CI 示例，没有产品发行证书或公证。下载运行时，操作系统可能提示未验证的开发者；正式分发需接入自己的签名和公证流程。

## CI 平台和费用

工作流在公开仓库使用 `ubuntu-24.04`、`windows-2025` 和 `macos-15`，按各 runner 的本机架构构建。三者都是标准 GitHub 托管 runner，公开仓库的标准 runner 计算时间免费。[GitHub 计费说明](https://docs.github.com/en/actions/concepts/billing-and-usage)

工作流的 job 要求 `github.event.repository.private == false`。改为私有仓库后整个矩阵跳过，避免意外消耗私有仓库计算额度。未使用 `-large` 或 `-xlarge` runner。

依赖和 Actions 均固定版本；应用不含运行时 npm 依赖。BLA `3.0.1` 的 `bankrupt` 预设会显著增加 ASAR header，体积和构建时间可从本次 `dist/build.json` 查看。升级 BLA、Electron 或打包工具时，重新运行全部平台，检查这些代价及应用行为。
