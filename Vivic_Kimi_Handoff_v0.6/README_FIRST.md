# Vivic v0.6 — Kimi K3 开发交接包

**文档日期：2026-10-14** · **状态：MVP 范围冻结，组件具体版本/兼容性须 PoC 验证** · **语言：中文**

## 请先读这四份

1. `AGENTS.md`：最高优先级的不可违背约束，重点解决“Agent 手搓丑 UI / 擅自添加元素”。
2. `PRD.md`：产品定义、场景、行为和验收范围；本版替代所有 v0.1–v0.5 文档。
3. `COMPONENT_LOCK.md`：组件锁定/候选/调研清单；必须安装真实样式，不可虚构能力。
4. `ARCHITECTURE.md` + `AUTH_SEARCH_PI.md`：Web 双页面、Pi 网页查询、密钥安全及运行时隔离。

另读：`CARD_CONTRACT.md`、`MOTION_AND_VISUAL_QA.md`、`ACCEPTANCE.md`、`contracts/action-envelope.schema.json`、`contracts/card-record.schema.json`、`KIMI_START_PROMPT.md`。

## 一句话

> Vivic = **语音/文字操控的极简多画布 + 有生命感的环境反馈 + 卡片化的真实信息查询**。绝不是聊天大窗、Dashboard、Coding Agent。

## 当前首要目标

先做**可真实运行并有录屏的精致 Web 视觉闭环**：黑屏 Orb → 唤醒扩散 Grainient → 创建极简倒计时/待办/搜索卡 → 镜头聚焦/删除/撤销 → 底部灵动字幕。然后连同机双窗口，再连接 Pi 查询和真实 LLM/语音。

## 最重要的变更（相较旧版本）

- **Pi 不再只是后期研究**：MVP 要验证 `@mariozechner/pi-coding-agent` 的受限工具运行模式 + `pi-web-access` 网页搜索/读取，首选**不要求用户另配搜索 API Key**。
- 但 **Pi 默认 `read/write/edit/bash` 工具一律禁止进入 Vivic**。Pi 用作模型登录/查询承载层，而非编程代理。
- `pi-web-access` 的零 Key 是一个第三方后端能力，实际网络/配额/可用性**必须实测**；无 Key 不等于离线、不收费保证或无需传数据给第三方。
- `pi-web-access` 单独 MCP server 模式**不能默认复用 Pi 的 Codex 登录搜索**；若需复用，须在 Pi Extension 所处的真实 Pi 运行上下文验证。
- 用户个人版优先：StepFun API Key + Pi 个人登录 PoC；会员、商业化登录与条款为未来研究，不是 MVP 承诺。
- 一个项目只做一个 Web App，两种视图：`/control` 与 `/display`；无需 Electron/Tauri 或系统截图权限。
- 唤醒球非 Rive 眼睛；Grainient 默认、Vanta Clouds 可选、Liquid Ether 非默认；设置只在控制端展示，展示端绝不出现工具条和说明文字。
- 记忆 = 多画布中的卡片及 sourceData；不建长期个人记忆系统。

## Kimi 操作顺序

1. 读取全部文档及 `reference/atmosphere_original.html`，总结锁定技术、候选风险，禁止直接开始大规模业务代码。
2. 做 Phase 0 的 **组件有效性和视觉兼容性 PoC**，真实运行并截图/录屏；React Flow、Assistant UI、Grainient、Orb 可以共存后再推进。
3. 按 PRD Phase 1–3 逐步实现；每阶段运行测试、给出处和性能事实，提交可审查的 Demo。
4. 任一组件不符合要求，先提供截图、版本、失败原因和现成替代品比较，不得偷偷手写替代。

**注意**：把 `reference/atmosphere_original.html` 用作视觉运动参考，不将整个页面、工具栏、侧边栏搬入 Vivic Display。
