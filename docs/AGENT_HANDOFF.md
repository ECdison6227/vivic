# 下一位 Agent：Vivic 交接

交接日期：2026-10-15。工作目录 `/Users/cjr/Projects/vivic`，macOS Apple M1 / 8 GiB。用户准备切换 Agent，当前任务是交付和人工测试，**不是要求重新开始项目或再次完整重做 PoC**。

## 用户最新确认：先暂停后续开发

本节优先于下文历史的「继续完成剩余所有」和建议顺序。用户可能新开 session，目前只要求说明已做功能、解释提醒支持范围并保留交接；不要自行继续功能开发、下载模型或启动新评测。

- **音色复刻暂缓**：已有 File ID 接口原型和证据保留，不继续录音/上传/复刻闭环，不做真实克隆或试听。
- **真实语音由用户后续手动验收**：到测试时再提供输入、步骤、预期结果和记录方式。继续遵守自动化静音、不采集物理麦克风；本次不是播放或开麦授权。
- **真机兼容与流畅度由用户后续测试**：Safari、外接屏、实际 GPU、输出设备和听感仍待本人验收，不因长测通过而标成真机已通过。
- **全部浏览器关闭后不需要提醒**：从未完成清单移除，不开发原生后台服务或推送。保留现有 Control 打开时调度、持久化及恢复处理，不为此删除已有逻辑。
- 用户表示 **GPT 已登录**：不重复索取凭据或强制重新登录；没有进一步要求时不额外发起连接探测。此前复用 Pi 的记录与新的用户登录操作不能合并成一次新 OAuth 验收。
- **Kev 中文效果不满足用户要求**：保留默认关闭的实验入口与失败/放弃证据；后续恢复开发时评估其他本地决策模型，重点验证中文、误执行、否定/复合指令、指代和本机内存/延迟。现在不开始新评测，不把 Kev 当成最终选型。
- 月/年、节假日和天气等外部条件提醒尚未实现；这不影响现有天气卡、每天/每周提醒。先解释范围，不据此自动扩展任务。

## 先读与用户意图

先读根 [README_FIRST.md](../README_FIRST.md)、[交付](DELIVERY.md)、[人工测试输入](MANUAL_TEST.md)、[实施现状](implementation-status.md)，再按任务读原 [PRD](../Vivic_Kimi_Handoff_v0.6/PRD.md)、[AGENTS](../Vivic_Kimi_Handoff_v0.6/AGENTS.md)、架构/组件/契约。旧模块报告里的「尚未集成」常是当时的历史状态，不能覆盖当前主线。

用户要求先完成主线开发，再统一调整体验。最近重点是卡片重叠、三事项提醒、思考反馈、音色、本地识别/唤醒以及只提供 StepFun Coding Plan 和 GPT/Pi 两种决策连接。本轮已落地这些主线，但 [交付中的未完表](DELIVERY.md) 仍明确保留实验、未实现细节和现场验收。

最新用户要求：在 `agent/next-iteration` 修复实际反馈，再继续未完计划。用户最终更正为「上海天气」「给我创建一个表格」思考结束后没有卡片/解释，不是待办问题。已补齐数据澄清的展示字幕、真实地点选项、天气/表格续答；已继续完成统一清除本地数据入口。增量详情与最新检查见 [next-iteration.md](next-iteration.md)，下文原交接验证数字保留为历史基线。

随后用户继续原计划，已实现[固定预录短反馈、逐词字幕、PCM 振幅](voice-feedback.md)。预录素材已随仓库附许可/散列；生成与测试没有播放扬声器或开麦。真实 StepFun 词轴及听感仍待验收，不要重复开发或误称实际套餐已测。

## 本轮剩余计划的最新状态

已继续完成[剩余计划实现](remaining-plan.md)：浏览器精确操作不走 LLM；日期/重复/画布条件提醒；固定公网 DNS 备选和真实正文读取；可选 Kev-0.8B 准备/启用/停止/清理；输出设备选择、静音通知、已有 File ID 的 Plan 音色复刻；WebKit Blob 缓存回退。模型与权限测试仍不播放、不采集真实麦克风。

Winnow 已定位为 [EldanRing/Winnow-E4B](https://huggingface.co/EldanRing/Winnow-E4B)，8.01GB Q8 不适合当前 8GB M1；不再向用户追问项目链接。采用用户允许的 [Kev](local-decision.md)，原始中文正确率 68.89%，必须保留默认关闭和严格放弃策略，不把实验改称通用可靠路由。模型不是第三种远程聊天 LLM。

最终验证摘要见 `docs/verification/next-plan.json`；旧阶段数字与旧失败记录仅保留为历史事实。后续只处理真实测试反馈和外部验收，不重写这些模块。

## 不可遗失的约束

- 中文沟通，直接推进已授权工作。不要让用户反复说「继续」，也不要假称启动了子代理。此前子代理均已完成并关闭，没有后台在途实现任务。
- 当前自动化测试静音，TTS 保持关闭，不播放扬声器、不采集物理麦克风。过去一次听音授权不当作持续授权；用户本人可按清单选择测试时机。
- 浏览器自动化已获允许，使用独立 context/存储，不能在用户真实窗口里输入、改画布或读出 Key。
- LLM 只有 StepFun Coding Plan 和 GPT。GPT 迁移现有 Pi OAuth/provider，不重写 OAuth，不接更多 provider；语音与 LLM 独立。
- Pi 没有 coding agent session、read/write/edit/bash、扩展/skills 或宿主自动配置。模型只发校验后的结构化 Action。
- 维持批准的真实组件和极简 Display，Countdown 默认只有数字；不把设置/聊天/调试面板加到 Display。
- Key 仅后端内存，不进源码/日志/浏览器/导出。Pi 凭据留在原安全存储并遵守刷新锁；断开 Vivic 不登出用户 Pi。不从聊天抄 Key 到项目文件。
- 不放宽 fetch 私网/重定向/DNS 防护来规避 fake-IP；不把搜索摘要称为已阅读全文，不编造天气或数值。

## 运行与连接

- Web：`http://localhost:5173/control` / `/display`；API：`http://127.0.0.1:8787`。
- 当前已有后台 `pnpm dev`，日志 `/tmp/vivic-dev-$(id -u).log`。切 Agent 不需要重启；先请求 `/healthz` 或检查端口，避免占用重复服务。
- 从零启动：Node >=22.19.0，`pnpm install`、`pnpm dev`。API 的本机 bearer 位于被忽略的 `apps/local-api/.env.local`，代理注入，不能打印文件内容。
- 交接检查时 StepFun 和 GPT 均连接，当前 StepFun `step-3.5-flash`，GPT `gpt-6-luna`。这是易失进程状态，后端重载会清空连接；不要反复要求用户发送 Key。GPT 可通过 Control「使用本机 Pi 登录」恢复现有授权。
- StepFun 默认 3.5 不按视觉处理。图片须选实际支持视觉的模型，例如目录中有权限的 3.7 flash/5 preview，或已验证 GPT。
- 云语音仅走 Plan 路径；不静默 fallback 到普通按量计费 API。
- 本次增量曾触发 API watch 热重载，StepFun 内存 Key 已断开，不能从文件或聊天恢复。收尾已通过应用既有接口复用 Pi 授权恢复 GPT（gpt-6-luna），未新开 OAuth，也未更改原模型选择。连接是易失状态；StepFun 在 Control 重连。

## 代码导航

| 模块 | 主要位置 / 实现要点 |
| --- | --- |
| 动作契约 | `packages/contracts/src/{actionEnvelope,cardRecord,vivicState}.ts`；原交接 JSON 契约也已同步 `card.update.variant` |
| 排版 / 撤销 | `apps/web/src/state/canvasStore.ts`：按尺寸保留空间，固定/恢复坐标作为障碍，Todo 16px 行宽估计，Note 展开高度，密度更新只允许 Note 且不能同时改原文 |
| 同步 / 持久化 | `sync/controlHost.ts`：owner 验证交互、保存后同步、旧重叠画布修复、`arrangeCanvas()`；`displayClient.ts` 不写 DB |
| React Flow | `canvas/CanvasView.tsx`：保留 measured 尺寸，避免旧 #015/RO 重测问题；minZoom 0.05；Display 拖动先预览，owner 确认才持久化 |
| 文字 / 澄清 | `commands/{parse,references}.ts`、`control/ControlApp.tsx`；expand/collapse 歧义选择发 variant + fit，不得误发 focus/delete |
| 主题 | `sync/protocol.ts` 的可选 dayStart/dayEnd，旧记录兼容；`motion/motionDirector.ts`、`stage/StageRoot.tsx`；默认 07:00–19:00、跨夜/分钟边界/隐藏恢复 |
| 卡片 | `cards/*CardView.tsx`，Recharts + styled Table；真实天气来源链接和 Radix HoverCard；负数 pie 不伪造比例 |
| GPT / Pi | `apps/local-api/src/gpt/**`、`PROVENANCE.md`：Pi 1.2.0，OAuth-only AuthStorage，public/legacy 路由区分；目录上限 4MiB、推理/搜索 512KiB；完整 SSE completed 才接受结果 |
| 本地决策 | `local-api/src/decision/`、`scripts/decision-model/`；固定 Kev 选择评分器、离线加载、超时放弃，默认关闭；见 [决策说明](local-decision.md) |
| 数据与搜索 | `local-api/src/data/**`、`search/**`、`intent/searchSummary.ts`；数值来自明确输入或既有数据，比较摘要只能引用已有证据 |
| 图片 | `ai/attachments.ts`、`control/ImageAttachment.tsx`、API `images.ts`/`imageDecoder.ts`：4MiB/16MP/8192 边上限，Sharp 全像素解码，当前请求内存附件 |
| 本地语音 | `ai/localSpeech/**`、`control/LocalSpeechSettings.tsx`/`LocalWakeInput.tsx`；固定模型 manifest，按需下载/SHA/取消/清理，显式前台单句；不是后台常驻唤醒 |
| 语音与提醒 | `ai/speech.ts`/`speechTelemetry.ts`、`public/voice-feedback/`、`reminders/**`、API `speechStream.ts`；固定短句、同流词轴/浏览器边界、PCM 包络通过现有 activity 广播，只有 owner 播放 |
| 统一清除 | `control/DataActions.tsx`、`sync/controlHost.ts` 的 `clearLocalData()`、`persistence/db.ts` 的原子 reset；`local-data-reset` 通知已打开窗口，清除前取消在途请求和语音；后端账号/Pi 存储不动 |

完整模块说明在 `docs/`，许可证及固定来源在根 `LICENSES.md`。

## 最新验证

[最终增量摘要](verification/next-plan.json)：Web 354 + API 855 = 1,209 项通过，3 项外部条件跳过；类型/构建通过。Chromium 原全套 71/73 的两个旧断言在后续 10/10 专项中复核通过；最新 Firefox/WebKit 专项 16/16。最终冻结 Web snapshot 不录屏，真实 30 分 2.577 秒，24/24、60 卡完整、原生 GL 丢失停止绘制，无页面异常，资源已清理。完整边界及证据见 [剩余计划交付](remaining-plan.md)。

## 原交接回归事实与限制

可移植摘要：[verification/phase3-final.json](verification/phase3-final.json)。Web 317 + API 793 = 1110 项单测通过，另 3 项跳过；类型/构建通过。完整 Chromium 58/58，最后受影响功能 11/11；Firefox/WebKit 排版 12/12、设置/便笺 6/6，分别记录。

真实证据保留本机：

- `evidence/phase3-final/REPORT.md` 及各 JSON/日志，`layout/` 是标注 TEST 的合成卡截图。
- `evidence/phase3-live-browser/live.json` 与截图/录屏：真实 GPT 图片算式 43、天气、表格、柱图、搜索 5/5；7 卡刷新前后无重叠。
- `evidence/phase3-gpt/live.json`：复用既有 Pi，真实推理/三提醒/订阅检索 3/3。
- `evidence/phase3-local-speech/REPORT.md`：17/17，合成录音/真实权重/虚拟 AudioWorklet；默认唤醒词只有词表/初始化，不是声学验收。
- 原 `2026-10-15T08-04-07-253Z-chromium` snapshot 的真实 30 分钟保留主题选择器错误，原修正复核只有短专项；不要改写这些原始记录。本轮最终源码另有 `2026-10-15T13-39-03-281Z-chromium` 完整长测，见上方最新验证。

已知限制：两张均 Pin 且互相重叠时不擅自移动；手动拖动允许自行重叠，之后可「重新排布」。任意布局不等于已覆盖无限组合。Firefox 服务器转发日志曾出现 BackgroundLayer React 更新告警；功能通过但不能声称所有日志为零。构建有上游 Sherpaw/包体积提示。

## 下一轮建议顺序

1. 接收 [人工清单](MANUAL_TEST.md) 的真实反馈，优先修复错删、事项遗漏、数值错误、重叠/丢卡及连接权限问题；不要先增加接入方式。
2. 安排本人语音/默认唤醒词及物理 Safari/外接屏验收；自动化仍静音。新 GPT 登录只在用户确实要新登录时完整走原 Pi 流程。
3. 统一清除、预录反馈、字幕/振幅、重复/条件提醒、输出设备选择、静音通知及已有 File ID 的 Plan 复刻路径均已实现，不要重复开发。真实 Plan 权限、时间戳、声音复刻与听感仍待用户操作；当前禁止自动化实际发声。上传 Plan 路径未明确，不能猜测或切普通计费 API。
4. Kev 已有可选实验入口，优先收集真实中文输入的误判/放弃反馈；保留置信度、否定/复合语句和目标校验。Laya 原 NO_GO 证据保留，Winnow 身份已明确，但本机内存不适用。
5. 最终 Web 源码 `4db5446` 已完成不录屏 30 分 2.577 秒、24/24 检查，证据见验证摘要；Firefox 驱动回调更新已修正。保留慢帧/物理 GPU 限制及所有旧失败记录，不把这次通过描述成所有设备流畅度验收。

## 检查命令与端口

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @vivic/web exec playwright test
pnpm --filter @vivic/web exec playwright test --config playwright.compat.config.ts tests/e2e/overlap.spec.ts tests/e2e/phase3-settings.spec.ts
```

普通测试用 mock/TEST 数据，不证明真实服务权限。Playwright 使用 5174/8788，多个套件顺序跑；真实脚本 `scripts/verify-gpt.mjs`、`verify-live-browser.mjs` 会用用户套餐，按明确目的运行，不反复消耗额度。不得读取或输出认证文件内容。

## Git 交接

已从此前没有版本历史的目录建立 `main` 基线和 `v0.6-mvp-handoff-20261015` 标签，下一轮工作分支为 `agent/next-iteration`。没有远端，也没有推送。先 `git status --short --branch` 再工作，小步提交，详见 [Git 工作方式](GIT_WORKFLOW.md)。

源码/配置/锁文件/规格/本交付文档纳入基线；`.env*`、`.cache/`、`evidence/`、依赖、构建和测试输出保持忽略。本机证据/模型缓存仍在，不要 `git clean -fdx`。未来 clone 时须重新装依赖、下载可选语音模型并取得用户授权，不能从源码恢复 Key/用户画布。
