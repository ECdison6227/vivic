# 下一 case：三项体验优化

状态：用户已给出候选实施 prompt，当前仅评审和交接，**尚未授权现在开始实现**。先完成 [手动验收与新 GPT 登录验证](USER_ACCEPTANCE_NOW.md)，再按用户的新 case 指令启动。

工作目录 `/Users/cjr/Projects/vivic`，当前分支 `agent/next-iteration`。先读 README_FIRST、当前 AGENT_HANDOFF、原 COMPONENT_LOCK、`docs/research/hark-reuse-assessment.md`、`docs/research/open-source-experience-candidates.md`。研究提交 `e7b3f15`，只能用于研究结论，不能据此重复开发当前已有模块。

## 实施范围

1. **排版与材质**：参考 HARK 阅读层级/留白/半透明填充/安静节奏，通过现有 Assistant UI styled registry、Radix/shadcn、Motion 和主题 tokens 统一中文正文、标题、来源、数字及间距。沿用现有字体，Display 保持远看可读，Countdown 默认仅数字。保留 Grainient/Orb，协调公开参数，不给多卡叠加高成本 blur。不复制 HARK 压缩代码、私有组件、字体或天空程序。
2. **长内容详情**：优先 Control，用现有 Radix Dialog/Motion 阅读已有长便笺、文章正文、搜索摘要。只存稳定卡片 ID，从当前 store 读同一份内容，避免副本过期。支持键盘、Escape、焦点恢复、滚动和文字选择；处理切画布、目标删除、owner 变化。先复用已有 Markdown renderer，确有缺口才考虑 Streamdown。
3. **快速找卡**：Control 使用 shadcn Command/cmdk 和 pinyin-match，中文/全拼/首字母匹配标题、事项和便笺；显示类型/简短摘要，重复内容以稳定 ID 区分。入口 + Cmd/Ctrl+K，方向键/Enter/Escape 与中文 IME 正确。只匹配当前画布的活卡片，动态加载新增依赖，Display 不承担搜索代码。选中调用既有聚焦动作，不改内容、密度、固定状态；模糊匹配不直接删除。处理空结果、目标删除、切画布和只读权限，不自动抢 owner。

## 对原 prompt 的两条补充

- 详情弹窗的开关属于临时 UI 状态，不改 Note.variant；Note.variant 仍只控制画布展开/收起。阅读弹窗和卡片共用原始数据，不能因打开详情改原文或触发布局动作。
- 字号、行高、内边距变化要同步核对卡片测量与布局尺寸估算；保持固定卡避让、内容增长、撤销和旧画布恢复，两张均固定时不能擅自挪坐标。

## 验证与交付

先核对源码、保留工作区已有修改，只提交本次改动，小步提交，不推送/合并/发布。保留双视图、Action 校验、撤销与所有批准组件。

运行受影响前端测试、pnpm typecheck、pnpm build，以及详情/找卡的键盘、IME、生命周期浏览器回归。使用独立 context，5174/8788，不同 Playwright 命令串行；不操作用户真实画布，不开麦、不播放音频。

留实际截图并目视检查长文本、窄屏、材质、详情层、减少动效、固定卡和旧画布。最终说明改动、实际检查结果、剩余限制和提交。只完成这三项，不顺带引入研究名单的其他模块；不推进音色复刻或关闭浏览器后的提醒。其他本地决策模型是另一个后续任务，不与这次 UI 范围混做。
