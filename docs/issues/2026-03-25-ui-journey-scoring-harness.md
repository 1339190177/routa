---
title: "UI Journey Scoring Harness 方案"
date: "2026-03-25"
status: open
severity: medium
area: "ui-evaluation"
tags:
  - ui
  - evaluation
  - specialist
  - agent-eval
  - harness
  - journey-testing
reported_by: "codex"
related_issues:
  - "https://github.com/phodal/routa/issues/228"
github_issue: 228
github_state: "open"
github_url: "https://github.com/phodal/routa/issues/228"
---

# UI Journey Scoring Harness 方案（简化版）

## Summary

为 Routa.js 设计一个基于 Specialist + CLI 的 UI 评测 harness，借助模型（Claude、Codex 等）模拟真实用户旅程，对"功能适用度"进行打分。

第一版只做固定旅程执行 + 模型评分，不做自由探索复核。先验证"模型能不能稳定地给出有意义的 UI 体验评分"这个核心假设。

## Key Changes

### 1. 新增 specialist：`ui-journey-evaluator`

以 YAML specialist 形式定义，放在 `resources/specialists/tools/ui-journey-evaluator.yaml`，使用现有 `routa specialist run` 触发。

specialist 职责：
- 读取场景文件（通过 `read_file` 工具加载）
- 使用 Playwright MCP 工具驱动浏览器执行旅程
- 根据执行结果、截图、页面状态输出评分

输出结构按未来 workflow 可复用的方式设计，但第一版不做多 specialist 编排。

### 2. 场景文件：自然语言描述，不做 step-level DSL

每个评测场景维护一份场景文件，放在：

- `resources/ui-journeys/core-home-session.yaml`
- `resources/ui-journeys/kanban-automation.yaml`
- `resources/ui-journeys/team-automation.yaml`

场景文件只包含高层描述，具体步骤用自然语言，让 specialist + Playwright 工具自己执行：

```yaml
id: core-home-session
goal: "从首页进入 workspace，选择 provider，提交 prompt，跳转到 session 页面并验证可交互"
entry_url: "http://localhost:3000"
preconditions:
  - "至少存在一个 workspace"
  - "至少配置了一个 provider"
success_signals:
  - "成功跳转到 session 详情页"
  - "session 页面显示用户提交的 prompt 内容"
  - "页面可继续交互，无阻断性错误"
failure_signals:
  - "任何步骤出现页面白屏或 500 错误"
  - "提交 prompt 后未跳转"
  - "session 页面无法加载历史消息"
score_rubric: |
  重点关注：任务能否顺畅完成、路径是否清晰、
  出错时用户能否理解当前状态并恢复。
```

不做 `action: goto | click | fill ...` 这套 DSL。模型的理解能力比固定 selector 更能应对 UI 变化。

### 3. 评分模型：简单直接

每个场景输出：

- `task_fit_score`：总分，0-100
- `verdict`：`Good Fit` (≥80) / `Partial Fit` (60-79) / `Poor Fit` (<60)
- `findings`：发现列表，每条包含 `type` (issue/observation)、`description`、`severity`

硬失败规则：
- 关键目标未完成 → 最高 Partial Fit
- 关键路径中断且无法恢复 → 直接 Poor Fit

不做四维度加权拆分。等跑了几轮有数据后再校准维度和权重。

### 4. 输出 artifact

每次运行产出：

```
artifacts/ui-journey/<scenario-id>/<run-id>/
  evaluation.json    # 评分结果 + findings
  screenshots/       # 关键步骤截图
  summary.md         # 人类可读结论
```

`evaluation.json` 结构：

```json
{
  "scenario_id": "core-home-session",
  "run_id": "2026-03-25-001",
  "task_fit_score": 85,
  "verdict": "Good Fit",
  "findings": [
    {
      "type": "observation",
      "description": "provider 选择下拉框加载耗时约 3 秒",
      "severity": "low"
    }
  ],
  "evidence_summary": "所有关键步骤完成，无 console 错误，无 network 失败"
}
```

console/network 错误作为评分输入证据写进 findings，不单独输出文件。

### 5. CLI 入口

```bash
routa specialist run ui-journey-evaluator \
  --workspace-id <id> \
  --provider <provider> \
  --prompt "scenario: core-home-session, base_url: http://localhost:3000, artifact_dir: artifacts/ui-journey"
```

不修改现有 CLI 语义。prompt 里约定场景 ID、base URL、artifact 输出目录。

## Test Plan

第一版覆盖 3 条旅程：

1. 核心主链路：首页 → workspace → 选 provider → 提交 prompt → session 详情页
2. Kanban 自动化：workspace kanban → 创建卡 → 移到自动化列 → 验证 session 触发和状态反馈
3. Team 自动化：team 页面 → 触发 session 流程 → 验证协作状态和页面反馈

验收标准：
- specialist 能跑完整个场景并输出 evaluation.json + screenshots + summary.md
- 同一场景跑 3-5 次，记录评分波动范围作为 baseline
- 评分与执行证据（截图、findings）逻辑一致

## 真实运行结果（2026-03-25）

执行了可复现的命令做真实验证：

- `cargo run -p routa-cli -- specialist run --help`
- `HOME=/tmp/codex-routa-test XDG_CONFIG_HOME=/tmp/codex-routa-test/.config cargo run -p routa-cli -- specialist run ui-journey-evaluator --workspace-id default --provider opencode --prompt "scenario: core-home-session, base_url: http://localhost:3000, artifact_dir: /tmp/ui-journey-artifacts"`
- `HOME=/tmp/codex-routa-test XDG_CONFIG_HOME=/tmp/codex-routa-test/.config cargo run -p routa-cli -- specialist run resources/specialists/tools/ui-journey-evaluator.yaml --workspace-id default --provider opencode --prompt "scenario: core-home-session, base_url: http://localhost:3000, artifact_dir: /tmp/ui-journey-artifacts"`
- `cargo run -p routa-cli -- specialist run ui-journey-evaluator --workspace-id default --provider claude --prompt "scenario: core-home-session, base_url: http://localhost:3000, artifact_dir: /tmp/ui-journey-artifacts"`

结果：

1. `specialist run --help` 已更新为新参数定义，`Run` 支持 `specialist` 参数（支持 specialist id 或定义文件路径）；
2. 在未隔离 HOME 时，opencode 因 `~/.config/opencode/opencode.json` 写权限失败而提前报错；
3. 隔离 HOME 后，opencode 进入初始化阶段后仍出现 `Timeout waiting for initialize (id=1, 15000ms)`；
4. claude provider 报告 `Not logged in · Please run /login` 并未进入完整会话；
5. 使用 yaml 文件路径参数可被正确识别并执行到同样运行链路，但仍被 provider 可用性问题阻断，尚未产出 `evaluation.json / summary.md / screenshots` 的闭环结果。

结论：方案方向是合理的，路径识别/参数分发逻辑已验证通过，当前不达成验收是 provider 初始化与鉴权条件不满足导致，属于执行环境问题而非设计范式问题。

## 进一步优化方案

1. 增加 provider 预检（优先级高）
   - 在运行前检查 provider 可执行体、配置目录可写性、claude 登录态等；若不满足，直接 fail-fast。
   - 失败时要产出低分结论与建议命令（例如登录、清理配置目录），减少“无产物挂起”。

2. 把初始化超时与重试参数化（优先级高）
   - 为 `specialist run` 加 `--provider-timeout`，并在 prompt 参数中支持 `provider_timeout_ms`；
   - 支持 1 次可控重试，减少偶发启动抖动导致的误报。

3. 保障失败路径也落盘（优先级高）
   - 无论成功/失败，固定产出：
     - `evaluation.json`（含 `task_fit_score`、`verdict`、`findings`）
     - `summary.md`（写清失败原因与复盘建议）
     - `screenshots/`（若有可用截图则写入）
   - 找不到关键 artifact 的情况下也要给出 `result: incomplete` 并写入原因码。

4. 丰富运行观察指标
   - 增加运行耗时、重试次数、初始化阶段耗时、失败阶段标签，方便后续回归。

## 未来扩展（不在第一版范围）

- 自由探索复核（低分时触发模型自主探索）
- 多维度加权评分（goal_completion、journey_friction、clarity 等）
- 接入 fitness 体系作为 `ui_journey` 维度
- 结果写回 kanban/session/Review lane
- 升级为 `workflow run` 封装

## Assumptions

- 第一版优先追求"可运行、可复盘、可扩展"。
- 固定旅程执行通过 specialist 调用 Playwright MCP 工具完成，步骤由模型根据自然语言描述自主执行。
- 结果先写 artifact，不直接写回 kanban/session。
- `FEATURE_TREE.md` 只作为场景发现和覆盖清单来源，不作为评分依据。
