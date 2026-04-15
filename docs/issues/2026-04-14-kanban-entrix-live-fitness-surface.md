---
title: "Kanban should surface Entrix fitness state in real time"
date: "2026-04-14"
kind: issue
status: open
severity: medium
area: "kanban"
tags: ["kanban", "entrix", "fitness", "realtime", "ui", "observability"]
reported_by: "codex"
related_issues: [
  "docs/issues/2026-03-19-kanban-flow-observability-and-control-gaps.md",
  "docs/issues/2026-04-11-routa-watch-entrix-fast-fitness-tui.md"
]
github_issue: 442
github_state: open
github_url: "https://github.com/phodal/routa/issues/442"
---

# Kanban 应该实时显示 Entrix fitness 状态

## What Happened

截至 2026-04-15，`Entrix` runtime 已经可以产出 live fitness event / artifact，但 `/workspace/{workspaceId}/kanban` 仍然只展示 board / task / session 运行态，不展示 repo fitness 运行态。这个缺口在 Web 和 Desktop 两条 backend surface 都存在。

结果是：Kanban 已经是任务执行的主工作台，但用户在这个页面里看不到当前仓库的 fitness 是否正在运行、最近一次结果是否通过、是否存在 hard gate / score blocker，也无法第一时间获知状态变化。

## Current Code Status (2026-04-15)

- `crates/entrix/src/main.rs` 在每次 `entrix run` 后都会调用 `emit_runtime_fitness_event` / `write_runtime_fitness_artifacts`。
- 运行态数据的 canonical 输出路径现在在 `crates/entrix/src/cli_runtime.rs`：
  - `/tmp/harness-monitor/runtime/<repo-hash>/events.jsonl`
  - `/tmp/harness-monitor/runtime/<repo-hash>/artifacts/fitness/latest-{mode}.json`
  - `/tmp/harness-monitor/runtime/<repo-hash>/mailbox/fitness/new/<observed_at_ms>-<mode>.json`
- `crates/harness-monitor/src/ui/cache_history.rs` 和 `crates/harness-monitor/src/ui/cache.rs` 已经会优先读取 latest mailbox event / artifact；说明 runtime source 已经被一个现有 UI 成功消费。
- `src/app/api/fitness/report/route.ts` 和 `crates/routa-server/src/api/fitness.rs` 目前仍然只读取 `docs/fitness/reports/harness-fluency-*.json` 快照，并返回 `source: "snapshot"`。
- `src/app/api/fitness/analyze/route.ts` 与 Rust 对应实现可以显式触发分析，但它们是“请求触发 -> 同步返回结果”的诊断接口，不是 Kanban 可订阅的 live runtime read model。
- `src/core/kanban/kanban-event-broadcaster.ts` 与 `crates/routa-server/src/api/kanban.rs` 目前只广播 `kanban:changed`；事件模型只覆盖 `task | board | column | queue` 变化。
- `src/client/hooks/use-kanban-events.ts` 只在 `connected` 或 `kanban:changed` 时触发 invalidation。
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx` 只拉取 boards、tasks、sessions、specialists、repo changes 等上下文，没有 fitness state loading。
- `src/app/workspace/[workspaceId]/kanban/kanban-status-bar.tsx` 只显示 repo / file changes / git log / sync / running / queued / provider，没有 fitness badge 或 summary。

## Expected Behavior

`/workspace/{workspaceId}/kanban` 应该为当前 workspace / codebase 提供一个紧凑的 Entrix 运行态面板，并在 fitness 结果变化时自动刷新。

这个 surface 至少应该能回答：

- 当前是否有 fitness run 在进行中
- 最近一次结果来自哪种 mode / tier
- 最近一次结果的状态、分数、时间戳
- 是否存在 blocker / hard gate failure
- 点击后能跳转或展开到 `/settings/fluency` 查看完整分析

同时它应该保持双后端语义一致，不要求用户切到 `/settings/fluency` 才能知道当前 repo 健康状态。

## Reproduction Context

- Environment: both
- Trigger:
  1. 打开 `http://localhost:3000/workspace/default/kanban` 或桌面对应 Kanban 页面
  2. 运行 `entrix run --tier fast`、`entrix run --tier normal`，或通过会触发 Entrix 的自动化链路执行一次 fitness
  3. runtime 目录和 `harness-monitor` 会出现结果变化，但 Kanban 页面不会出现对应状态，也不会通过 SSE 自动刷新

## Why This Still Happens

- Runtime fitness 的 canonical read model 目前只被 `harness-monitor` 消费，没有进入 Web/Desktop `/api` 层。
- `/api/fitness/report` 读的是持久化 fluency snapshot，不是 live runtime mailbox / artifact。
- Kanban 的 SSE 通道是 board-domain 专用通道，没有承载 `fitness:changed` 或等价事件。
- 现有 `FitnessAnalysisPanel` 面向 `/settings/fluency` 设计，信息密度和交互深度都偏诊断台，不适合直接原样嵌入 Kanban 主工作面。

## Suggested First Slice

- 新增一个 workspace / codebase-aware 的 runtime fitness read endpoint，优先读取 mailbox / latest artifact，必要时回退到 snapshot。
- 扩展 Kanban 事件模型，加入 `fitness:changed` 或一个更通用的 workspace observability event。
- 在 `kanban-status-bar` 或 board header 增加紧凑 fitness badge / pulse，而不是直接嵌完整 `FitnessAnalysisPanel`。
- 保持 `/settings/fluency` 作为深度诊断入口，Kanban 只显示摘要与 blocker signal。

## Relevant Files

- `crates/entrix/src/main.rs`
- `crates/entrix/src/cli_runtime.rs`
- `crates/harness-monitor/src/ui/cache_history.rs`
- `crates/harness-monitor/src/ui/cache.rs`
- `src/app/api/fitness/report/route.ts`
- `src/app/api/fitness/analyze/route.ts`
- `crates/routa-server/src/api/fitness.rs`
- `src/client/components/fitness-analysis-panel.tsx`
- `src/client/hooks/use-kanban-events.ts`
- `src/core/kanban/kanban-event-broadcaster.ts`
- `crates/routa-server/src/api/kanban.rs`
- `src/app/api/kanban/events/route.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-status-bar.tsx`
- `src/app/settings/fluency/fluency-settings-page-client.tsx`

## Observations

- `harness-monitor` 已经证明“优先读取 runtime mailbox / artifact，再决定是否 rerun”这条路径可行；Kanban 没必要重新发明评分模型。
- 这个问题与 `2026-03-19-kanban-flow-observability-and-control-gaps.md` 相邻，但范围更窄。后者讨论的是 Kanban flow metrics 和治理原语；本问题只聚焦于 Entrix 运行态进入 Kanban 主工作面。
- 风险最低的首个切片仍然不是把完整 Fluency 控制台复制进 Kanban，而是提供一个紧凑的 status surface，并把深度分析留给现有 Fluency 页面。

## References

- `docs/issues/2026-03-19-kanban-flow-observability-and-control-gaps.md`
- `docs/issues/2026-04-11-routa-watch-entrix-fast-fitness-tui.md`
- `https://github.com/phodal/routa/issues/410`
