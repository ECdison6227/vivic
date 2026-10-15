# Vivic 实施现状与剩余范围

更新：2026-10-15。依据 PRD v0.6、验收清单、源码和实际运行记录。本文件覆盖旧报告中的「尚未接入」描述；历史报告保留原始事实，不回写为成功。现场验收仍未结束。

当前只提供 **StepFun Coding Plan、GPT（迁移 Pi 既有 OAuth）两种 LLM**。STT/TTS 独立选择；没有语音服务仍可用文字。最新测试保持 TTS 关闭、浏览器静音，不采集物理麦克风。

同日增量见 [测试反馈修复与本地数据入口](next-iteration.md)：天气/表格澄清及一轮续答、统一清除本地数据已完成；此前阶段报告中相应未实现描述为历史状态。

后续 [语音反馈增量](voice-feedback.md)已补齐固定预录短句、StepFun 词轴接入、浏览器边界高亮与 PCM 振幅反馈。真实云服务的词轴权限和实际听感仍未验收。

本轮剩余计划已继续实现，见 [当前增量](remaining-plan.md) 与 [Kev 决策说明](local-decision.md)。旧报告不再作为重复开发清单。

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
| 统一清除本地数据 | Control 确认入口；清除全部画布/提醒/偏好/语音模型，取消在途请求；原子替换画布与元数据，旧模型下载 lease 失效；多 Control/Display 同步、刷新/接管后不恢复旧内容。账号连接保留。[增量说明](next-iteration.md)。 |

## 仍需现场或外部条件验证

| 项目 | 当前结论与剩余工作 |
| --- | --- |
| Laya | CPU/MPS 共 216 次真实推理；当前模型/适配复现组合 **NO_GO**，未接生产。联合正确 5/36、官方示例 1/2；须先定位上游/模型/适配差异，不能推广为所有版本能力结论。[PoC](laya-poc.md)。 |
| 本地决策 | Winnow-E4B 上游已确定，8.01GB Q8 不选用于当前 8GB M1；采用固定 Kev-0.8B 可选实验入口。真实推理、准备/启用/释放已验证；中文原始 68.89%，过滤仅接纳 25/180。规则优先，不执行模型删除，未接纳的回到原流程。 |
| 网页正文 | 实际静态正文已读取成功；仅 fake-IP 系统答案使用固定 TLS DoH，继续拦截私网/混合/非法答案，每跳固定地址。只保留有界实际正文，不保证登录/脚本渲染内容。Exa 配额仍由外部服务决定。 |
| 麦克风和唤醒 | 真实模型中文文件、VAD、虚拟 AudioWorklet 通过；本人语音、默认唤醒词召回/误触发、多设备、5 分钟监听仍需现场测试。仅承诺显式前台单次监听。 |
| 浏览器和长期稳定性 | 最终源码无录屏真实 30 分 2.577 秒、24/24 检查通过；旧选择器失败和中断记录保留。最新 Firefox/WebKit 16/16。Headless 有慢帧，不能称实际 GPU 流畅度验收；真实 Safari/外接屏待验收。[稳定性事实](stability.md)。 |
| 新 GPT 登录 | 已复用 Pi 现有凭据并真实推理/搜索/图片分析；新的交互式登录流程尚未完整实测。用户实际需要时走一次原 Pi 授权，不重写 OAuth。 |
| 复杂提醒 | 日期、间隔、每天/工作日/指定周几、明确时区、画布待办/倒计时完成条件已实现并持久化；可选静音系统通知。任意外部条件、月/年和所有跨时区口语不作普遍承诺；Control 全关闭/睡眠仍只能恢复后补报。 |
| 语音细节验收 | 固定预录短句、StepFun 词轴、浏览器边界高亮、PCM 振幅及统一清除均已实现。仍需实际听感/真实 Plan 时间戳账户验收；系统语音没有 PCM 则保持零振幅。见 [语音增量](voice-feedback.md)。 |

浏览器 TTS 只列出系统标记为 localService 的声音，可用性及离线效果依赖系统；Sherpaw 本次提供 ASR/VAD/KWS，不称其自带 TTS。

输出设备选择及已有 File ID 的 Plan 音色复刻已实现；不自动播放/录音或上传，不把替身测试称为真实账户权限。WebKit 模型缓存增加 Blob→ArrayBuffer 安全回退，旧 lease/清除语义保留。

## 暂缓

Google/Claude/Grok、第三种 LLM、新 OAuth 协议；只读日历/网页预览/更多 MCP；桌面宿主、系统截图/全局快捷键、跨设备配对、音乐、卡片商店、会员和公有云。这些不计入当前 MVP 主线。

最终检查数字、截图/录屏与验收映射见 [本轮交付报告](../evidence/phase3-final/REPORT.md)。

切换 Agent 时请从 [根启动入口](../README_FIRST.md) 开始；[交付](DELIVERY.md)、[人工测试输入](MANUAL_TEST.md)、[下一位 Agent 交接](AGENT_HANDOFF.md) 与 [Git 工作方式](GIT_WORKFLOW.md) 已单独整理。
