# Vivic 实施现状与剩余范围

更新：2026-10-15。依据 PRD v0.6、验收清单、源码和实际运行记录。本文件覆盖旧报告中的「尚未接入」描述；历史报告保留原始事实，不回写为成功。现场验收仍未结束。

当前只提供 **StepFun Coding Plan、GPT（迁移 Pi 既有 OAuth）两种 LLM**。STT/TTS 独立选择；没有语音服务仍可用文字。最新测试保持 TTS 关闭、浏览器静音，不采集物理麦克风。

## 已落地

| 范围 | 实际实现及证据 |
| --- | --- |
| 舞台和反馈 | 真实 SmoothUI Siri Orb、React Bits Grainient、Assistant UI styled registry、React Flow、Motion；待机/唤醒/工作/聚焦/字幕，思考/等待秒数/取消。单个 Orb 避让卡片，减少动效/WebGL 降级。[视觉基线](../evidence/phase0/REPORT.md)。 |
| 双窗和多画布 | 同源同步、持久化、导入导出、单 owner 接管、Display 拖动、固定卡片、主题/字幕/减少动效设置；自动日夜时段可修改（默认 07:00–19:00，支持跨夜、分钟边界与恢复后切换）。Display 不写数据库，主控验证保存后确认。[交互边界](canvas-interaction.md)。 |
| 提醒 | 多事项创建，按时长/事项引用，修改/暂停/恢复/取消，到时字幕/光晕/串行语音，跨画布检查，交付记录，成组删除/撤销。[真实提醒](../evidence/phase2-reminders/REPORT.md)、[静默复验](../evidence/phase2-connected-silent/REPORT.md)。 |
| 决策和澄清 | 确定规则优先，复杂指令走所选 LLM，严格 Action/目标/来源校验；短期一轮澄清上下文。真实 GPT 三提醒正确返回 480/600/780 秒。[GPT 验证](../evidence/phase3-gpt/live.json)。 |
| GPT / Pi | 复用原 AuthStorage 的锁与刷新，新登录调用 Pi 原 OAuth；模型目录/探测/选择、断开、订阅检索。已有 Pi 登录真实推理/搜索/图片成功；没有 Pi agent session、编程工具、扩展或 skills。[迁移来源](../apps/local-api/src/gpt/PROVENANCE.md)。 |
| 搜索 | 同 Plan Key 的 StepSearch，GPT 订阅搜索，来源卡、去重、有证据约束的比较摘要；切换连接丢弃旧结果。搜索不等于逐页全文已读。[StepSearch](../evidence/phase2-stepsearch/REPORT.md)、[真实全页流程](../evidence/phase3-live-browser/live.json)。 |
| 七种卡片 | Countdown/Todo/Note/SearchResult/Weather/Table/Chart 均有实际 renderer；Recharts 线/柱/饼图，表格行高亮；便笺支持文字/语音展开与收起，歧义选择，保留原文，聚焦不改密度。负数饼图保留原值以表格展示。[卡片](data-cards.md)。 |
| 真实数据 | 有界 Open-Meteo 地名/天气查询、歧义澄清、时间/来源；明确数字输入生成表/图，已有表/图转换，模型不能虚构数字。[数据提供方](data-providers.md)、[真实天气记录](../evidence/data-providers/open-meteo-live.json)。 |
| 图片 | 控制端上传/拖放/粘贴；静态 PNG/JPEG/WebP 一张；本地重编码、明确发送、能力检测，后端 Sharp 完整像素解码。图片仅用于本轮，不进入画布/导出/历史。[图片边界](image-input.md)、[真实图片算式](../evidence/phase3-live-browser/live.json)。 |
| StepFun 语音 | Plan PTT/ASR、默认检查转写；TTS 默认关闭，8 音色/试听/语速/音量，真实播放事件驱动 Orb/字幕。GPT OAuth 不当作音频 API 授权。[语音架构](provider-voice-architecture.md)。 |
| 本地语音 | Sherpaw 按需下载/进度/取消/SHA 校验/清理，ASR/VAD/KWS Worker，显式前台单次唤醒；独立浏览器本地声音输出。[真实文件 PoC 17/17](../evidence/phase3-local-speech/REPORT.md)。默认「你好维维」的实际声学效果仍属实验。 |
| 卡片排版 | 按宽高与长内容预留空间、避开固定卡；内容增长重排、撤销保留恢复位置；owner 检测并保存旧画布的重叠修复；控制端「重新排布」及同名指令。[真实 7 卡刷新前后无重叠](../evidence/phase3-live-browser/live.json)。两张均固定且彼此重叠时需先解除固定。 |

## 仍需现场或外部条件验证

| 项目 | 当前结论与剩余工作 |
| --- | --- |
| Laya | CPU/MPS 共 216 次真实推理；当前模型/适配复现组合 **NO_GO**，未接生产。联合正确 5/36、官方示例 1/2；须先定位上游/模型/适配差异，不能推广为所有版本能力结论。[PoC](laya-poc.md)。 |
| Winnow | **BLOCKED**：准确上游项目和可复现接口未确定，未下载、未假装接入。保持规则 → 已连接的 StepFun/GPT。 |
| 任意网页全文 | 安全拦截已做，真实公网 fetch 仍受本机 fake-IP DNS 影响；Exa 零 Key 额度也曾失败。不放宽私网/文件/重定向防护，使用已验证的搜索与来源。 |
| 麦克风和唤醒 | 真实模型中文文件、VAD、虚拟 AudioWorklet 通过；本人语音、默认唤醒词召回/误触发、多设备、5 分钟监听仍需现场测试。仅承诺显式前台单次监听。 |
| 浏览器和长期稳定性 | Chromium/Firefox/WebKit 已实跑；WebKit 不等于物理 Safari。旧 snapshot 30 分钟长测保留一个测试选择器错误，修正后短专项通过，不冒充最新代码一次全绿 30 分钟验收。真实 Safari/外接屏/无录屏 GPU 基线待验收。[稳定性事实](stability.md)。 |
| 新 GPT 登录 | 已复用 Pi 现有凭据并真实推理/搜索/图片分析；新的交互式登录流程尚未完整实测。用户实际需要时走一次原 Pi 授权，不重写 OAuth。 |
| 复杂提醒 | 日常一次性提醒已实现；重复/条件/复杂日期及跨时区口语未覆盖。关闭全部控制页后没有系统后台通知；浏览器节流/系统睡眠只能恢复后补报，不保证准点唤醒。 |
| 原计划未完细节 | 合法预录短反馈、StepFun 逐词时间戳/声音振幅反馈，以及统一「清除全部本地数据」入口尚未实现；当前支持播放状态反馈、单画布清空/删除与独立模型缓存清理。见 [交付清单](DELIVERY.md)。 |

浏览器 TTS 只列出系统标记为 localService 的声音，可用性及离线效果依赖系统；Sherpaw 本次提供 ASR/VAD/KWS，不称其自带 TTS。

## 暂缓

Google/Claude/Grok、第三种 LLM、新 OAuth 协议；只读日历/网页预览/更多 MCP；桌面宿主、系统截图/全局快捷键、跨设备配对、音乐、卡片商店、会员和公有云。这些不计入当前 MVP 主线。

最终检查数字、截图/录屏与验收映射见 [本轮交付报告](../evidence/phase3-final/REPORT.md)。

切换 Agent 时请从 [根启动入口](../README_FIRST.md) 开始；[交付](DELIVERY.md)、[人工测试输入](MANUAL_TEST.md)、[下一位 Agent 交接](AGENT_HANDOFF.md) 与 [Git 工作方式](GIT_WORKFLOW.md) 已单独整理。
