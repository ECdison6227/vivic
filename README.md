# Vivic v0.6 — 双页面信息画布

自然语言驱动的极简信息画布，Web First 个人版 MVP。当前已实现 **StepFun Coding Plan / GPT 两种 LLM、独立语音选择、七类卡片、真实天气、数值图表及转换、当次图片分析、拖动与 Pin**。GPT 复用既有 Pi OAuth 的真实推理、搜索和视觉已有本机证据。最新真实 7 卡浏览器流程 **5/5 通过，刷新前后均无重叠**；Chromium 全套 **58/58 通过**。最终单测 1110 项通过，类型与构建通过；物理语音、新 OAuth 交互及新版长期稳定性等仍有明确验收边界。

一个 Web 应用两条路由：`/control` 是唯一写入端，`/display` 是只读舞台。两窗口通过 BroadcastChannel snapshot/patch 同步，多画布使用 IndexedDB 保存。Display 可将拖动意图交给 Control owner 校验、落盘并确认，不自行写存储。规格见 `Vivic_Kimi_Handoff_v0.6/`；详细范围见 [实施现状](docs/implementation-status.md)。

交付入口：[直接复制的测试输入](docs/MANUAL_TEST.md) · [完成/未完与验收事实](docs/DELIVERY.md) · [下一位 Agent 交接](docs/AGENT_HANDOFF.md) · [Git 分支约定](docs/GIT_WORKFLOW.md)。新 Agent 先读根目录 `README_FIRST.md`。

## 启动

需要 Node **>=22.19.0**（Pi 1.2.0 的运行要求）和 workspace 指定的 pnpm。

```sh
pnpm install
pnpm dev          # web :5173；local-api 127.0.0.1:8787
```

`pnpm dev:web` / `pnpm dev:api` 可分别启动。`pnpm build` 后，本机 API 进程也可托管 `apps/web/dist`。服务仅绑定 loopback；本地 bearer 由开发代理在服务端注入，浏览器不持有该令牌。后端热重启会清空 StepFun 内存 Key，需要重连。

## 模型与独立语音

控制端仅提供 **StepFun Coding Plan** 与 **GPT（Pi OAuth）** 两个 LLM 选项。

- StepFun：粘贴 Plan Key，目录和短 JSON 推理均通过后才显示连接成功。Key 只在本机后端内存，不进入日志、浏览器存储、画布或导出。推理、ASR、TTS 使用 Plan 路径，不静默改投普通按量接口。
- GPT：已安装 `@earendil-works/pi-ai` / `pi-coding-agent` **1.2.0**，复用 Pi 的既有 OAuth、刷新和 provider 传输；真实 `gpt-6-luna` 推理与搜索已通过。没有 coding agent session、文件/shell 工具、extensions 或 skills。新登录入口已实现，但完整的新 OAuth 浏览器授权交互尚未实测。
- **ASR 与 TTS 分别选择，与 LLM 解耦**：ASR 可选 StepFun、本地 Sherpaw 或关闭；TTS 可选 StepFun、浏览器本地音色或关闭。GPT 未连接语音时仍可完整使用文字/卡片，不把 OAuth 当作语音 API 授权。
- StepFun Plan ASR/PTT、8 种 TTS 音色已有历史真实接口证据。浏览器 TTS 使用声明 `localService` 的音色，不属于 Sherpaw TTS，也未证明任意设备断网可用。

**最新测试静音、TTS 关闭。** 既往单次发声测试只属于对应历史记录，不构成持续发声授权或当前听感验收。详见 [模型与语音架构](docs/provider-voice-architecture.md)、[Plan 语音](docs/stepfun-plan-tts.md)。

## 本地语音与前台单句入口

Sherpaw **0.3.0** 的 ASR/KWS/VAD 和模型设置已接入。用户按需下载固定模型，校验字节数与 SHA-256 后缓存到浏览器；默认不下载、不自动开麦。X-ASR 约 169.23 MB、KWS 约 13.08 MB、Silero VAD 约 2.31 MB；模型大小不是运行内存上限。

PTT 松开后转写，默认先放入输入框检查。VAD/KWS 每次点击只处理前台单句，最长等待 300 秒、单段最长 60 秒，结束后需重新开启；失焦、隐藏、取消、切画布或失去 owner 时停止。不承诺锁屏、后台或关闭 Control 后持续唤醒。

[本地语音证据](evidence/phase3-local-speech/REPORT.md)记录 17/17 独立生产浏览器项目：合成 WAV 的真实 X-ASR、VAD→ASR、虚拟 AudioWorklet 重采样，以及录音中「十分钟」的 KWS 命中。默认「你好维维」仅验证词表/native 初始化和静音不触发，**物理麦克风、该短语声学命中及误唤醒率尚未验收**。浏览器 TTS 仅做模拟原生事件测试，没有本地音色实际发声证据。接口和下载见 [local-speech](docs/local-speech.md)。

## 七类卡片、数据与图片

Countdown、Todo、Note、SearchResult、Weather、Table、Chart 七类卡片均有 renderer。默认 minimal：倒计时只有数字，天气只有温度和图标；原始依据保留在 sourceData/sources，focus 不增加展示字段。

- 提醒：`10分钟后提醒我喝水，20分钟后提醒我休息`；支持多事项、修改/暂停/取消、跨画布到期标记及防重复交付。关闭 Control 或系统休眠期间不承诺准时播报。
- 搜索：StepFun 使用同一 Plan Key 的官方 StepSearch；GPT 使用已有 OAuth 的 Responses 搜索，保留真实 URL。无凭据 Exa 备选的 fake-IP DNS/额度问题仍存在；任意网页 `/fetch` 保持 DNS 全地址校验和 socket pin，fake-IP 被拒绝。搜索成功不代表全文读取成功，不编造来源或静默转付费路径。
- 天气：Open-Meteo 无 Key 当前模型天气，必须明确城市，同名地点澄清。已实测 `上海,上海市天气`，保留 GeoNames 地点、模型有效时间和原始查询 URL，不冒称站点观测。温度/图标整体带来源链接，Radix HoverCard 按需显示 Open-Meteo、GeoNames、CC BY 4.0 和转换说明，默认最简视图不加 footer。
- 数值：`用表格记录：苹果3，香蕉5`、`把这组数据画成折线图：周一3，周二5，周三4`。只接收明确数值，标记 `user-input`，sources 为空。现有表格可按唯一目标/明确焦点转柱状图、折线图或饼图，保留可恢复来源；歧义、负数饼图、缺失数据和混合删除均澄清，不让 LLM 补数。
- 图片：Control 支持单张 PNG/JPEG/WebP 文件、区域粘贴或拖入；浏览器重绘后只随当次显式请求发送。后端 Sharp **0.35.5** 完整解码，模型无视觉能力时拒绝。图片不进入 Display 同步、持久化、导出或后续上下文。真实浏览器用自生成 TEST 图片识别 `17 + 26 = 43`，不代表所有用户图片均已验收。

对应说明：[数据源与转换](docs/data-providers.md)、[七卡 renderer](docs/data-cards.md)、[图片与解码](docs/image-input.md)。

## 画布交互

Control 可管理画布、主题、减少动效、Pin/取消 Pin、导出导入和撤销。Display 不增加工具栏；拖动只发送受限 `card.move`，owner 检查画布/epoch/版本/layout 基线、限流、去重并落盘，再同步确认。Pinned 卡不可拖动；未 Pin 卡仍可能参与后续自动布局。Fit 只改镜头。Auto 日夜主题支持自定义本地开始/结束时间（默认 07:00–19:00，可跨夜），背景与卡片同步按分钟切换；手动浅/深色优先。便笺可说「展开这张便笺」「收起便笺」，多张时先选择目标，原文保留。

已有 10/30/60 卡创建、刷新和拖动的浏览器记录。最新真实 7 卡场景修复后，刷新前后的 `overlaps` 均为空数组；该结论限于已测场景，不概括为任意卡片组合均无重叠。详见 [canvas-interaction](docs/canvas-interaction.md)。

## 已有证据与剩余边界

| 记录 | 实际证明的范围 |
| --- | --- |
| [GPT live](evidence/phase3-gpt/live.json) | 既有 Pi OAuth 真实推理、多事项提醒结果及订阅搜索；动作仅检查、未派发，无图片/声音/物理麦克风 |
| [真实浏览器 live](evidence/phase3-live-browser/live.json) | 5/5 通过：GPT 视觉 TEST 算式、天气、用户表格、表格转柱状图、GPT 搜索；刷新保留 7 卡，刷新前后 overlaps 均为 []，pageErrors 为空；音频与物理麦克风关闭 |
| [Chromium 全套](evidence/phase3-final/chromium.json) | 58/58 通过，约 4.5 分钟；与真实账号/公网流程和长期 soak 分别记录 |
| [本地语音归档](evidence/phase3-local-speech/REPORT.md) | 固定模型文件、真实 WASM、合成音频、取消/缓存完整性及设置 UI；不是现场人声或本地 TTS 发声验收 |
| [稳定性最终审计](evidence/phase3-stability/final-resource-audit.json) | 旧快照约 30 分钟 23/24 检查通过、主题检查失败；另一次完整运行中断；新快照 14/14 专项通过、soak 约 61 秒，不能称新版 30 分钟全通过 |

Laya 当前组合 **NO_GO / MODEL_OR_ADAPTER_UNCERTAIN**，未进入生产；Winnow **BLOCKED**，未下载、未运行，见 [本机决策实验](docs/laya-poc.md)。新 OAuth 交互、物理麦克风、默认唤醒短语声学验收、Safari/长时监听、本地 TTS 听感、新版完整长期稳定性仍待验证。

## 检查命令

```sh
pnpm typecheck
pnpm test
cd apps/web && pnpm exec playwright test
```

这些是复现入口，不代表本次文档更新重新执行了测试。真实联网测试需对应用户授权/模型连接；离线测试不能替代账号权限验收。最新测试按静音、TTS 关闭执行，不自动开麦或播放音频。

## 目录

```text
apps/web             Control / Display、七卡、React Flow、同步、持久化、图片及本地语音
apps/local-api       loopback API、StepFun、Pi GPT、搜索、天气/数值、图片解码与动作校验
packages/contracts   ActionEnvelope / CardRecord / VivicState 共享 schema
docs                 模块说明；组件、包与模型许可另见根 LICENSES.md
evidence             原始 JSON、截图和录屏，合成数据与真实 provider 结果分别标明
Vivic_Kimi_Handoff_v0.6  产品与验收规格
```
