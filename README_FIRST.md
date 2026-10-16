# Vivic：从这里继续

本项目已经有可运行的 MVP 主线，**不要重新开始 Phase 0 或重写已完成模块**。

2026-10-16 全项目完成度核对见 [brief 审计](docs/project-audit-20261016.md)：三项体验优化已实现，但生产调试入口、JSON 契约一致性、完整回归及现场验收仍有收尾项。该核对用于区分当前状态与历史阶段说明。

1. 阅读 [下一位 Agent 交接](docs/AGENT_HANDOFF.md)：当前状态、运行方式、约束与建议顺序。
2. 阅读 [交付说明](docs/DELIVERY.md) 和 [用户测试清单](docs/MANUAL_TEST.md)。
3. 阅读 [实施现状](docs/implementation-status.md)，区分完成、实验、阻塞与暂缓项。
4. 遵守 [原开发规约](Vivic_Kimi_Handoff_v0.6/AGENTS.md)；产品依据为 [PRD](Vivic_Kimi_Handoff_v0.6/PRD.md) 与同目录架构、组件、契约及验收文档。
5. [原启动指令](Vivic_Kimi_Handoff_v0.6/KIMI_START_PROMPT.md) 保留为历史入口；其中阶段顺序不能覆盖本次交接的实际进度。

切换 Agent 不要求重启服务。开发后端重启会清空 StepFun 内存 Key；不要因此误判账号权限，也不要把 Key 写入文件。最新自动化测试保持静音，不采集物理麦克风。
