# 主仓库 Checkout Index 污染：Agent staged 变更残留

**日期**: 2026-05-17
**严重程度**: 中（不影响代码质量，但产生看板 UI 噪音和用户困惑）
**状态**: 已确认，待修复

## 问题

看板 UI 显示 `1339190177/CodeYield-HuiLife @ main` 有 `1 dirty` — 332 个文件处于 staged 状态，但 HEAD 与 origin/main 完全一致（同一 commit `0e08ab8`）。

## 现象

```
UNSTAGED  (实际是 staged，UI 显示可能混淆)
332 files with changes
```

分类：

| 类型 | 数量 | 示例 |
|------|------|------|
| A（新增） | 81 | `products/tanshengyi/demo/dist/assets/*.js` 构建产物 |
| M（修改） | 87 | `.gitignore`, `CLAUDE.md`, `pnpm-lock.yaml` 等 |
| D（删除） | 164 | `scripts/iteration-loop-prompt.md`, `package-lock.json` 等 |

## 根因链

1. **`WorkspaceTools.gitCommit()`**（`src/core/tools/workspace-tools.ts:193`）在 `stageAll: true` 时执行 `git add -A`
2. **`defaultCwd`** 在 `routa-system.ts:105` 创建 `WorkspaceTools` 时**未传入** `defaultCwd`，默认为 `process.cwd()`（即 Routa 项目根目录）
3. **Agent 调用 `git_commit`** 时如果未显式传 `cwd` 参数，则 fallback 到 `defaultCwd`
4. 当 agent session 的 `cwd` 通过 `acp-session-create.ts:307` 正确解析为 worktree 路径时没问题；但：
   - 部分 agent 工具调用未传 `cwd`，直接操作了主 checkout
   - 或 worktree 与主 checkout 共享 `.git` 目录（git worktree 机制），`git add -A` 的 index 污染了主 checkout

5. **`.gitignore` 被修改**：某个 agent 删除了 `products/tanshengyi/demo/dist/` 和 `node_modules/\ndist/\ndata/` 的 gitignore 规则，导致 dist 目录下的 81 个构建文件被 staged

## 关键代码路径

```
acp-session-create.ts:527 → initRoutaOrchestrator({ defaultCwd: cwd })
  ↓ (cwd = worktree.worktreePath, 如果有 worktree)
orchestrator.ts:462 → const cwd = params.cwd ?? this.config.defaultCwd
  ↓
workspace-tools.ts:168 → const cwd = params.cwd ?? this.defaultCwd
  ↓
workspace-tools.ts:194 → git add -A (在 cwd 中执行)
```

**问题点**：`routa-system.ts:105` 中 `new WorkspaceTools(agentStore, taskStore, noteStore)` **未传 `defaultCwd`**，所以 MCP tool 调用 `gitStatus/gitDiff/gitCommit` 时 fallback 到 `getServerBridge().env.currentDir()`，这可能不是 worktree 路径。

## 修复方案

### 方案 1：MCP 工具层防护（推荐，最小侵入）

在 `workspace-tools.ts` 的 `gitCommit()` 中添加安全检查：

```typescript
// 在 gitCommit 方法中，stageAll 逻辑之前：
if (params.stageAll) {
  // 安全检查：如果是主 checkout 目录（非 worktree），拒绝 git add -A
  const isWorktree = cwd.includes('/issue-') || cwd.includes('\\issue-');
  const mainCheckoutPattern = /repos[\\/][^/]+--[^/]+$/;
  if (!isWorktree && mainCheckoutPattern.test(cwd)) {
    return errorResult(
      `Safety check: refusing 'git add -A' in main checkout (${cwd}). ` +
      `Use specific file paths or ensure cwd points to a worktree.`
    );
  }
  await execFileAsync("git", ["add", "-A"], { cwd, timeout: 10000 });
}
```

### 方案 2：任务完成后自动清理 index（兜底）

在 `DoneLaneRecovery` 或 worktree cleanup 流程中，添加主 checkout index 重置：

```typescript
// 在 worktree cleanup 之后
const mainCheckoutPath = getMainCheckoutPath(task);
await execFileAsync("git", ["reset", "HEAD"], { cwd: mainCheckoutPath });
await execFileAsync("git", ["checkout", "--", "."], { cwd: mainCheckoutPath });
```

### 方案 3：MCP 调用时强制传入 cwd（根修复）

确保所有 agent session 的 MCP 工具调用都显式传入正确的 worktree cwd，而非依赖 `defaultCwd` fallback。

## 临时修复

手动清理主 checkout 的 index：

```bash
cd .routa/repos/1339190177--CodeYield-HuiLife
git reset HEAD
git checkout -- .
git clean -fd products/tanshengyi/demo/dist/
```

## 影响评估

- **代码质量**：无影响（变更仅在 index 中，未 commit）
- **看板 UI**：显示 "1 dirty"，造成用户困惑
- **流水线运行**：无影响（agent 操作 worktree 中的代码，主 checkout 的 index 不影响）
- **风险**：如果用户误操作（如手动 commit），可能将这些残留变更推送到 main
