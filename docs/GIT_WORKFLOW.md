# 本地 Git 工作方式

2026-10-15 首次建立版本历史。此前目录没有 `.git`，不能补造旧版本提交，也没有远端备份。

## 基线与下一轮

- `main`：本轮已验证的源码和交付基线。
- `v0.6-mvp-handoff-20261015`：本次交接标签；这是 checkpoint，不表示所有实验项均通过验收。
- `agent/next-iteration`：从同一基线建立，留给下一位 Agent 继续；交接后默认位于此分支。
- 未配置远端、未推送、未发布。需要跨电脑备份时，再配置用户指定的私人远端。

下一位 Agent 先检查：

```sh
git status --short --branch
git log -3 --oneline --decorate
git branch --list
```

在当前分支按一个可复核改动提交一次，提交说明写清具体结果与必要验证。不要把未通过检查的修改直接合并到 main；阶段完成后再 review/merge。新工作较独立时可另开 `feature/说明` 或 `fix/说明`，无需为每一个 Agent 建永久分支。

## 被忽略的本机内容

`.env*`、`node_modules/`、`.cache/`、构建目录、测试输出及 `evidence/` 不入 Git。本机模型缓存约 1.9GB，证据约 807MB；这些数值只代表建立基线时的磁盘占用。文件继续保留，不会因切分支消失。

可移植的验收摘要保存在 [verification/phase3-final.json](verification/phase3-final.json)。完整 JSON/截图/录屏位于当前机器的 `evidence/`，**单独 clone 仓库不会自动带回它们**；真实账号验收也不能由该摘要代替。导出的用户画布和账号凭据不作为源码基线保存。

## 回看基线

```sh
git show v0.6-mvp-handoff-20261015:docs/AGENT_HANDOFF.md
```

先确认工作区没有未保存修改，再决定是否切分支。无需为了回看而使用 `reset --hard`、`clean -fdx` 或强推。尤其不要运行 `git clean -fdx`，它会删除被忽略的本机缓存、环境文件和证据。
