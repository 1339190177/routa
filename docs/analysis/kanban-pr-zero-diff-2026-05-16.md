# 看板流水线盲区：零差异分支 PR 创建失败

**日期**: 2026-05-16
**严重程度**: 低（不影响代码质量，仅产生日志噪音）
**状态**: 已确认，待优化

## 问题

DoneLaneRecovery 每次心跳（~3 分钟）对 5 个已完成任务输出 PR 创建失败 ERR 日志。其中一个任务 [R5-FINAL-V1] 经分析确认为流水线对"纯验证无代码变更"任务的处理盲区。

## 受影响任务

| 任务ID | 标题 | 创建时间 | 根因分类 |
|--------|------|---------|---------|
| `3167ab09` | [R5-FINAL-V1] Spec fitness + 宪法合规静态验证 | 05-16 02:12 | 零差异分支，PR 无法创建 |
| `1426d6d4` | [TF-06] 营收统计 | 05-14 18:47 | 待分析 |
| `54a0c0cb` | [T7-03] Spec-to-Code 全量校验 | 05-14 18:47 | 待分析 |
| `a13bddb6` | [T7-01-B2.1] 菜单列表展示与分类分组 | 05-15 09:49 | 待分析 |
| `e065f614` | [TF-25] 个人中心 | 05-14 18:47 | 待分析 |

## 已确认根因：R5-FINAL-V1

**任务性质**：纯静态验证任务，目标为检查 Spec 对齐度和代码宪法合规性，范围明确标注"仅记录，不修复"。

**流水线追踪**：
- Backlog → Todo → Dev → Review → Done，全流程正常通过
- Dev 阶段：Agent 在 worktree 中执行 grep/CLI 验证命令，无代码产出
- Review 阶段：Review Guard 确认验收标准满足

**PR 创建失败链**：
1. `PrAutoCreate` 检测到任务 COMPLETED，尝试 `gh pr create`
2. 分支 `issue/r5-final-v1-spec-fitness-3167ab09` HEAD 与 `main` 指向同一 commit (`57dd02b`)
3. `gh pr create` 因无差异而失败（exit code 非零）
4. 重试 3 次后达到 `PR_RETRY_LIMIT`，永久跳过
5. 后续每次 `DoneLaneRecovery` tick 都会重新尝试并记录 ERR

## 日志噪音模式

```
[ERR] [PrAutoCreate] Task 3167ab09-eabb-4099-9004-a849c1aca262 exceeded 3 PR creation attempts. Skipping.
[ERR] [DoneLaneRecovery] PR creation returned no URL for task 3167ab09-eabb-4099-9004-a849c1aca262
```

每 ~3 分钟重复一次，5 个任务共产生约 10 条 ERR/tick。

## 建议修复方向

1. **PrAutoCreate 前置检查**：在调用 `gh pr create` 前，先 `git diff --stat main...HEAD`，零差异时直接标记 `NO_PR_NEEDED` 而非重试
2. **DoneLaneRecovery 跳过逻辑**：对 `pr_attempts >= PR_RETRY_LIMIT` 的任务，不再每 tick 重试，仅记录一次 summary
3. **任务类型标记**：纯验证/审计类任务在 story 中标记 `code_change: false`，Dev 完成后直接跳过 PR 阶段

## 影响评估

- **代码质量**：无影响（验证任务本身不产生代码变更）
- **流水线吞吐**：无影响（任务已正确流转至 Done）
- **日志可读性**：中低影响（噪音日志掩盖真实错误）
- **资源消耗**：极低（每次 tick 多几次 git 操作）
