# Routa 看板流水线缺陷分析

**日期**: 2026-05-15
**来源**: 8 个会话 JSONL 转录深度分析 + 全日日志监控 + 数据库状态交叉验证

**分析覆盖**:
- 会话 `fe71a35e`（CRAFTER T7-01b，10,748 行 JSONL）
- 会话 `fb921ac4`（GATE T7-01b review→dev 退回）
- 会话 `bbe354b7`（GATE T7-01-B2.4 第3次 review 通过）
- 会话 `66cac032`（GATE T7-01-B2.4 第1次 review 退回）
- 会话 `7fd2f4a6`（GATE T7-01-B2.4 第2次 review 退回）
- 会话 `e1e026e7`（GATE T7-01 第1次 review）
- 会话 `fba62ae8`（GATE T7-01 第2次 review 通过）
- 会话 `6372cb72`（CRAFTER T7-01b 第二轮开发）
- 全日 `log/2026-05-15.log`（50,000+ 行日志统计）

---

## 缺陷 1: 开发环境预校验缺失

**严重度**: P1
**现象**: CRAFTER 会话启动时未验证 worktree 内的 node_modules 是否完整，导致 `npm run dev` 失败后才发现依赖缺失。
**根因**: LaneScanner 在触发 CRAFTER 前只检查 worktree 路径是否存在，不验证开发环境就绪状态。
**影响**: 会话启动后首次编译失败，浪费 5-10 分钟等待超时和重试。

**建议修复**:
- 在 LaneScanner 触发 CRAFTER 前，执行 `ls node_modules/.package-lock.json` 或 `npm ls --depth=0` 检查依赖完整性
- 不完整时自动执行 `npm install`

---

## 缺陷 2: 运行时验证能力缺失

**严重度**: P1
**现象**: CRAFTER 使用 mock interceptor 阻止所有真实 API 调用，任务完成后无法进行端到端验证。
**根因**: SDK 的网络拦截器默认拦截所有外部请求，没有白名单机制允许 localhost 验证请求通过。
**影响**: 代码可能通过编译但运行时行为不正确，直到人工介入才能发现。

**建议修复**:
- 为 localhost/127.0.0.1 请求添加白名单绕过拦截
- 或在任务完成后启动独立验证会话（无拦截器）运行验收命令

---

## 缺陷 3: 会话崩溃恢复机制缺失

**严重度**: P2
**现象**: 服务重启后，旧会话残留的 worktree lease 导致新会话创建 409 Conflict。
**根因**: HttpSessionStore 是内存存储，重启后 lease 信息丢失，但 SQLite 中的会话记录仍存在，状态不一致。
**影响**: 需要人工清理数据库或等待 lease 自然过期（5分钟），流水线停滞。

**建议修复**:
- RestartRecovery 启动时主动清理 status=running 的残留会话
- 将 lease 状态持久化到 SQLite 或使用分布式锁

---

## 缺陷 4: 任务质量门控缺失

**严重度**: P2
**现象**: CRAFTER 完成开发后直接进入 review 列，未做基本的跨文件一致性检查（如 import 路径有效性、TypeScript 类型错误）。
**根因**: dev→review 转换由 LaneScanner 直接触发，无中间质量关卡。
**影响**: GATE review 发现基础错误后退回 dev，增加完整往返周期（约 30-40 分钟浪费）。

**建议修复**:
- 在 dev→review 转换前增加轻量级 pre-check：`tsc --noEmit` + `eslint --max-warnings=0`
- 检查失败则阻止进入 review，自动重试 CRAFTER

---

## 缺陷 5: JSONL 日志膨胀

**严重度**: P3
**现象**: 单个 CRAFTER 会话生成 10,747 行 JSONL 日志，而数据库只记录 ~50 条结构化事件。
**根因**: SDK 每次工具调用（包括读取文件、搜索代码）都生成完整的 JSONL 条目，无截断或采样机制。
**影响**: 磁盘空间浪费，日志分析工具性能下降，JSONL 文件可达数十 MB。

**建议修复**:
- 添加 JSONL 日志轮转（按大小或行数）
- 对低价值事件（如 Read 工具调用）进行采样或压缩存储

---

## 缺陷 6: Turbopack 缓存无自愈能力

**严重度**: P2
**现象**: Turbopack 的 RocksDB 缓存（`.next/dev/cache/turbopack/`）SST 文件损坏后，compaction 持续失败（91+ 次错误），导致 5 分钟 MCP 请求阻塞和进程卡顿。
**根因**: RocksDB 检测到 SST 损坏后不自动清理和重建，而是反复尝试 compaction。
**影响**: 整个开发服务器响应变慢，流水线执行超时。

**建议修复**:
- 添加 Turbopack 缓存健康检查（启动时验证 SST 文件完整性）
- 检测到损坏时自动删除缓存目录并重建
- 或添加 `npm run dev -- --turbo-cache-cleanup` 命令

---

## 缺陷 7: Backward Transition 循环

**严重度**: P2
**现象**: 已完成的任务（COMPLETED）被反复推回 review/dev 列，Overseer 每 5 分钟自动修正为 COMPLETED，然后又被推回。
**根因**: 推回来源标记为 `user_action`，但实际可能是看板 UI 状态同步异常或 CDP 操作导致。
**影响**: 产生重复 PR（如 PR #304），浪费 CI 资源，DoneLaneRecovery 空转。

**建议修复**:
- 对 COMPLETED 任务添加状态锁，阻止非管理员 backward transition
- 增加更详细的 transition source 追踪（具体是哪个 API 调用/用户触发的）
- 检查看板 UI 状态同步逻辑是否存在竞态

---

## 缺陷 8: 并发控制导致会话排队饥饿

**严重度**: P2
**现象**: 多个任务同时就绪时，由于并发限制（默认 2-3 个 CRAFTER），后续任务在队列中等待过久。
**根因**: LaneScanner 每轮只扫描列头 N 个卡片，并发已满时跳过后续卡片，即使前面的会话可能已经超时或卡死。
**影响**: 任务等待时间从分钟级增加到小时级，整体流水线吞吐量降低。

**建议修复**:
- 实现会话超时检测：超过 30 分钟无进展的会话自动释放 slot
- 添加排队优先级：按任务依赖深度排序，关键路径任务优先
- 考虑动态并发控制：根据系统负载调整最大并发数

---

---

## 缺陷 9: GATE Review 模型幻觉导致误判退回

**严重度**: P0
**证据会话**: `fb921ac4`（GATE T7-01b review→dev）
**现象**: GATE 声称 `vite.config.ts:51-68` 中 `mockApiPlugin` 拦截了 `POST /api/merchants`，导致 AC4 判为"阻断性"，任务被退回。但实际 `mockApiPlugin` 仅拦截 3 个通知/天气路由，**完全不拦截** `POST /api/merchants`。
**根因**: 模型在处理长文件时产生幻觉（hallucination），将 `mockApiPlugin` 函数名的存在与搜索 pattern `POST.*merchants` 关联，虚构了不存在的拦截逻辑。
**影响**: T7-01b 被错误退回 dev，浪费一轮完整 CRAFTER 重新开发（~30 分钟 + 86,866 tokens）。

**建议修复**:
- GATE review 结论必须附带具体行号引用和原文引用，便于自动校验
- 添加事实性断言检查：GATE 声称的代码行为与实际文件内容交叉验证
- 降低 GATE 对单条"发现"的权重——需要多个独立证据支持阻断性判断

---

## 缺陷 10: GATE 二次 Review "盲审通过"（零代码验证）

**严重度**: P0
**证据会话**: `bbe354b7`（GATE T7-01-B2.4 第3次 review，APPROVED）
**现象**: 第二次 GATE review 只有 3 个 tool_call（`update_card` + `move_card`），**零个代码读取工具调用**（无 Read/Grep/Bash）。完全基于 prompt 注入的上下文做出通过判断。
**对比**: 同一任务第一次 review（`66cac032`）有 21 次工具调用，用 curl 实测发现了真实 BUG（HTTP PUT vs POST 不匹配、字段名 `menu_ids` vs `ids` 不匹配）。
**根因**: GATE 二次 review 时接收了前一次 review 的上下文作为 system prompt，模型倾向于"相信"前次提出的问题已修复，不再独立验证。
**影响**: 可能通过了实际未修复的缺陷。AC 验收标准从 3/6 通过变为 6/6 通过，但无独立证据。

**建议修复**:
- 强制 GATE 二次 review 执行与首次相同的最小工具调用集（至少 Read 核心文件 + Grep 关键模式）
- 将前一次 review 的 reject 评论作为必检项：逐条验证每个被拒绝的 AC
- 添加 "review coverage score"：要求 GATE 的代码验证工具调用数 ≥ 首次 review 的 50%

---

## 缺陷 11: GATE 越界启动 Dev Server 做端到端测试

**严重度**: P1
**证据会话**: `66cac032`（GATE T7-01-B2.4 第1次 review）
**现象**: GATE 检测到 dev server 不可达后，主动启动 dev server（`npm run dev`），然后用 Playwright 导航页面、curl 调用 API。虽然发现了真实 BUG，但超出了 review 职责边界。
**根因**: GATE 的 system prompt 中没有明确禁止启动/管理运行时环境。
**影响**:
- GATE 会话时间大幅拉长（额外 2-3 万 tokens）
- 如果 GATE 忘记关 server，端口被占用
- dev server 进程可能泄露

**建议修复**:
- 在 GATE 的 system prompt 中明确禁止 `npm run dev`/`npm start` 等运行时命令
- GATE 验证应限制在：Read 代码、Grep 模式、审查 artifact、git diff 检查
- 如需运行时验证，应由独立的 VERIFIER 角色执行

---

## 缺陷 12: GATE AC 验收标准不一致（多轮 Review 摇摆）

**严重度**: P1
**证据会话**: `66cac032`（NOT_APPROVED）vs `bbe354b7`（APPROVED）
**现象**: 同一任务的同一 AC 在不同轮次 review 中判断不一致：
- AC2（下架标记）：第1次说"缺 line-through + 文字标签"，第3次直接通过
- AC3（批量操作）：第1次 curl 实测发现 PUT vs POST 不匹配，第3次声称通过但未验证
- AC6（错误回滚）：第1次指出无乐观更新，第3次声称有 try/catch 回滚
**根因**: 不同轮次的 GATE 会话独立初始化，没有共享的 AC 验证 checklist。模型对 AC 的解读随上下文变化。
**影响**: 验收质量不可预测，可能放行有缺陷的代码。

**建议修复**:
- 将前一次 review 的 reject 评论结构化存储为 checklist
- 后续 review 必须逐条回答 checklist 中的每个问题
- 对同一 AC 多次 review 的判断差异自动告警

---

## 缺陷 13: CRAFTER 合并冲突处理导致功能丢失

**严重度**: P1
**证据会话**: `7fd2f4a6`（GATE T7-01-B2.4 第2次 review）
**现象**: 合并提交 `ddf8a02` 将 MenuPage.tsx 回退到旧版本，Toggle 开关、乐观更新、删除线样式、价格显示全部损坏。GATE 通过对比 `aab5670`（正确）vs `ddf8a02`（当前 HEAD）发现。
**根因**: CRAFTER 在合并 origin/main 到分支时使用 `--theirs`（main 版本）覆盖了自己的实现文件。
**影响**: 功能完全丢失，需要额外的 CRAFTER 会话重新实现。

**建议修复**:
- CRAFTER 合并冲突时默认使用 `--ours`（分支版本）处理自己实现的文件
- 合并后自动执行 `git diff HEAD~1 --stat` 检查变更量，如果删除行数远大于新增行数则告警
- 添加合并后自动验证：检查关键函数/组件是否存在

---

## 缺陷 14: DoneLaneRecovery 61% 空转（无效轮询）

**严重度**: P1
**日志证据**: 2026-05-15 全日统计
**现象**: DoneLaneRecovery 全天执行 329 次 tick，其中 201 次（61%）为完全空转（examined=70, recovered=0, conflicts=0, stuck=0, completed=0）。
**根因**: DLR 以固定间隔（约 3 分钟）轮询所有 done 列卡片，即使没有任何变化。
**关联指标**:
- "Skip rebase-resolver"：596 次（已完成任务反复检查）
- "Skip conflict-resolver"：1,019 次
- "PR closed without merging, COMPLETED"：588 次

**建议修复**:
- DLR 应只在有新事件（card 移入 done 列、webhook 通知）时触发
- 已标记 COMPLETED 的任务应从 DLR 检查列表中排除
- 对 "PR closed but COMPLETED" 的任务添加永久标记，不再重复检查

---

## 缺陷 15: RestartRecovery 依赖阻塞噪声（2524 次）

**严重度**: P2
**日志证据**: 2026-05-15 全日统计
**现象**: `RestartRecovery Skipping ... blocked by` 日志出现 2,524 次。主要是 T7-01b 被 T7-01a 依赖阻塞，每轮 LaneScanner tick（~30s）都输出一次。
**根因**: RestartRecovery 每次检查所有 backlog/dev 列的卡片，包括已知被阻塞的卡片。没有"已跳过"缓存。
**影响**: 日志噪音严重，影响真正问题的发现。T7-01b 被阻塞了 6 小时（08:44→15:09），期间产生了数百条冗余日志。

**建议修复**:
- 添加 "dependency-blocked" 缓存：已知被阻塞的卡片在依赖任务完成前不再检查
- 依赖任务完成时主动触发被阻塞卡片的 unblock 检查（事件驱动而非轮询）

---

## 缺陷 16: 会话 JSONL 转录截断和 tool output 丢失

**严重度**: P2
**证据会话**: `e1e026e7`、`7fd2f4a6`
**现象**:
- 2 个会话 JSONL 文件缺少 metadata 行，第一个 thought chunk 从中间开始
- 所有会话的 `tool_call_update` 事件中 `rawOutput` 为空，无法审计 GATE 获取到的原始数据
- 多个会话中所有行的时间戳完全相同（批量写入时间，非实际执行时间）
**根因**: JSONL 写入可能在会话完成时批量 flush，而非实时追加。
**影响**: 无法进行事后审计，无法分析 GATE 在哪些步骤花了更多时间。

**建议修复**:
- JSONL 写入改为实时追加（append-only），每条事件独立时间戳
- 保存 tool_call 的 rawOutput（至少保存摘要）
- 添加会话 metadata 行（创建时间、模型版本、角色等）

---

## 缺陷 17: Pre-gate Check 形同虚设（99-110 个 blockers 被忽略）

**严重度**: P2
**日志证据**: 2026-05-15 全日 111 次
**现象**: 所有进入 review 列的任务都触发了 99-110 个 pre-gate blockers，但全部被标记为 "advisory"（建议性），流水线继续执行。没有任何任务因 pre-gate check 被阻止。
**根因**: Pre-gate check 的阻断阈值设置过高，或者 blocker 类型都是非阻断性的。
**影响**: Pre-gate check 机制完全无效——产生日志噪音但不影响任何决策。

**建议修复**:
- 重新评估 pre-gate blocker 的分类：区分"必须修复"和"建议修复"
- 对 TypeScript 编译错误、import 路径无效等硬性错误设置为阻断
- 对 constitution 违规、UI 一致性等软性问题保持 advisory

---

## 缺陷 18: 会话 Token 消耗严重不均

**严重度**: P2
**证据**: 全日 176 个会话统计
**现象**:
- T7-01-B2.4 单卡片 GATE review 消耗 237,431 tokens（3 轮 review）
- T7-01 Epic 级别（30 个页面）GATE review 消耗 149,412 tokens（2 轮 review）
- 子任务 review 消耗是 epic 级别的 1.6 倍
- 最大会话 `a897ce1e`（CRAFTER T7-01-E）生成 8,838 行 JSONL
- 每轮 GATE review 独立加载完整上下文，不共享前轮状态

**建议修复**:
- GATE review 应共享前轮上下文（至少传递 reject checklist）
- 添加单会话 token 预算上限（如 100K tokens）
- CRAFTER 会话超过 5000 行 JSONL 时自动告警

---

## 缺陷 19: Dev Server 端口管理——所有释放都带 failures=3

**严重度**: P2
**日志证据**: 2026-05-15 全日 34 次 dev server 释放
**现象**: 所有 `Releasing task dev server` 日志都显示 `failures=3`，意味着 dev server 从未正常关闭。
**根因**: CRAFTER/GATE 会话结束时可能没有执行优雅关闭 dev server 的逻辑。
**影响**: 端口可能泄露，后续任务启动 dev server 时可能端口冲突。

**建议修复**:
- 确保会话结束时主动 kill dev server 进程
- 添加端口占用检测：启动前检查端口是否可用
- failures=3 时自动清理进程

---

## 总结

| # | 缺陷 | 严重度 | 证据来源 | 修复难度 |
|---|------|--------|----------|----------|
| 1 | 开发环境预校验缺失 | P1 | fe71a35e CRAFTER | 低 |
| 2 | 运行时验证能力缺失 | P1 | fe71a35e CRAFTER | 中 |
| 3 | 会话崩溃恢复缺失 | P2 | 全日日志 | 中 |
| 4 | 任务质量门控缺失 | P2 | 多会话 | 低 |
| 5 | JSONL 日志膨胀 | P3 | fe71a35e (10,748行) | 低 |
| 6 | Turbopack 缓存无自愈 | P2 | 全日日志 (91+ compaction 失败) | 中 |
| 7 | Backward transition 循环 | P2 | 全日日志 (65 次，含 13 done→dev) | 高 |
| 8 | 并发控制饥饿 | P2 | 全日日志 (838 次排队) | 中 |
| 9 | **GATE 幻觉误判退回** | **P0** | fb921ac4 GATE | 高 |
| 10 | **GATE 盲审通过** | **P0** | bbe354b7 GATE (零代码验证) | 高 |
| 11 | GATE 越界启动 Dev Server | P1 | 66cac032 GATE | 低 |
| 12 | GATE AC 验收标准摇摆 | P1 | 66cac032 vs bbe354b7 | 中 |
| 13 | CRAFTER 合并冲突丢失功能 | P1 | 7fd2f4a6 GATE (ddf8a02 回退) | 中 |
| 14 | DLR 61% 空转 | P1 | 全日日志 (201/329 空) | 中 |
| 15 | RestartRecovery 阻塞噪声 | P2 | 全日日志 (2,524 次) | 低 |
| 16 | JSONL 转录截断 | P2 | e1e026e7, 7fd2f4a6 | 中 |
| 17 | Pre-gate check 形同虚设 | P2 | 全日日志 (111 次 advisory) | 低 |
| 18 | Token 消耗严重不均 | P2 | 全会话统计 | 中 |
| 19 | Dev Server 端口泄露 | P2 | 全日日志 (34 次 failures=3) | 低 |

## 缺陷 20: PrAutoCreate 空分支推送——缺少 commit 预检

**严重度**: P1
**证据**: T7-03 任务 `54a0c0cb`, 日志 17:15-17:33
**现象**: PrAutoCreate 对只读审计任务的 worktree 执行 `git push`, 创建空分支 (ahead_by=0 相对 main), `gh pr create` 连续 3 次失败报 "No commits between main and branch", 最终超过重试上限被永久跳过。
**根因**:
1. `PrAutoCreate` 在推送分支前没有执行 `git log origin/main..HEAD --oneline` 检查是否存在新 commit
2. 对于纯审计/只读任务 (T7-03 AC 明确 "仅报告, 不做代码修改"), CRAFTER 在 worktree 中只执行读操作, 不产生任何文件变更
3. 空分支被推送后, DLR 后续 tick 产生无效日志

**代码位置**: `src/core/kanban/pr-auto-create.ts:134-162` (push 前无 commit 检查)

**影响**:
- 空分支在远端残留
- 3 次 PR 创建重试消耗 18 分钟
- DLR 后续 tick 产生噪声日志

**建议修复**: push 前增加 `git log origin/main..HEAD --oneline` 检查, 无新 commit 则跳过 PR 创建。

---

**核心发现**: 两个 P0 缺陷都指向 GATE review 系统的可靠性问题。新增的 P1 缺陷 (#20) 暴露了 PrAutoCreate 对只读任务的处理缺陷, 应增加 commit 预检避免空分支推送。

**流水线最终状态 (17:36)**: 74/75 COMPLETED (98.7%), 1 ARCHIVED。PR #305/#306 冲突已手动解决推送, PR #308/#309 自动合并。T7-03 因空分支无法创建 PR, 状态为 COMPLETED 但无 PR。

**流水线缺陷汇总更新 (20 项)**:

| # | 缺陷 | 严重度 | 证据来源 | 修复优先级 |
|---|------|--------|----------|-----------|
| 1 | 开发环境预校验缺失 | P2 | fe71a35e CRAFTER | 低 |
| 2 | Session 历史膨胀 | P2 | fe71a35e (10,748行) | 低 |
| 3 | 幂等检查缺失 | P1 | 多会话 | 中 |
| 4 | 任务质量门控缺失 | P2 | 多会话 | 低 |
| 5 | JSONL 日志膨胀 | P3 | fe71a35e (10,748行) | 低 |
| 6 | Turbopack 缓存无自愈 | P2 | 全日日志 (91+ compaction 失败) | 中 |
| 7 | Backward transition 循环 | P2 | 全日日志 (65 次, 含 13 done->dev) | 高 |
| 8 | 并发控制饥饿 | P2 | 全日日志 (838 次排队) | 中 |
| 9 | **GATE 幻觉误判退回** | **P0** | fb921ac4 GATE | 高 |
| 10 | **GATE 盲审通过** | **P0** | bbe354b7 GATE (零代码验证) | 高 |
| 11 | GATE 越界启动 Dev Server | P1 | 66cac032 GATE | 低 |
| 12 | GATE AC 验收标准摇摆 | P1 | 66cac032 vs bbe354b7 | 中 |
| 13 | CRAFTER 合并冲突丢失功能 | P1 | 7fd2f4a6 GATE (ddf8a02 回退) | 中 |
| 14 | DLR 61% 空转 | P1 | 全日日志 (201/329 空) | 中 |
| 15 | RestartRecovery 阻塞噪声 | P2 | 全日日志 (2,524 次) | 低 |
| 16 | JSONL 转录截断 | P2 | e1e026e7, 7fd2f4a6 | 中 |
| 17 | Pre-gate check 形同虚设 | P2 | 全日日志 (111 次 advisory) | 低 |
| 18 | Token 消耗严重不均 | P2 | 全会话统计 | 中 |
| 19 | Dev Server 端口泄露 | P2 | 全日日志 (34 次 failures=3) | 低 |
| 20 | **PrAutoCreate 空分支推送** | **P1** | T7-03 (54a0c0cb) 3次重试失败 | 中 |