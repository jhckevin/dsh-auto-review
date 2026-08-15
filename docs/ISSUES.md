# 分阶段 ISSUE 路线图

每个 ISSUE 单独分支、单独提交组；关闭前必须重新查看固定 Harness 源码和本 ISSUE 改动。

## ISSUE-001：仓库、Bundle 与契约骨架（完成）

建立 package、Config schema、Cordis 导出、bundle patch、错误码和 Loader composition 测试。

验收：rc.6 依赖面、三角色子路径、bundle patch、TypeScript 离线构建、packed artifact。

## ISSUE-002：动作模型与确定性路由（完成）

建立 action-semantics registry、内置 fs/bash/web 分类器、同步 hard guard、canonical digest 和 workspace/sandbox policy 绑定。

已完成：v1 envelope、canonical SHA-256、最近直接用户授权证据、workspace/sensitive/production/process/network/sandbox-escalation 路由、effect-scoped 外部工具语义贡献、冲突检测与卸载、未知扩展 manual、配置 hard deny。

## ISSUE-003：隔离 LLM Reviewer（原型，重新打开）

建立独立模型调用、严格 JSON 协议、预算、脱敏、超时、取消、稳定错误和 fail-closed grant policy。

现状：无工具 one-shot、严格闭集 JSON、结构/文本预算、密钥脱敏、timeout/cancellation、provider effect ownership。它不是独立 Agent/Session，不能作为最终验收结论。

## ISSUE-004：审批、审计与断路器（部分完成）

接入 `ask`、durable decision events、不可变 `tools/result` 关联、shadow/enforcing、拒绝循环控制和 hash-linked 可选归档。

已完成：原生 `ask` 回退、sandbox escalation 一次性审批桥、routed/decision/result/breaker 审计、shadow/enforcing、fail-closed breaker、最终冻结结果关联，以及 effect-scoped、同步 fsync、hash-linked JSONL sink。因 rc.6 没有下游 Session event 注册面，审计不再写入会破坏冷恢复的未知 Session event；原生 approval pair 仍留在 Session Log。

拒绝后的反规避反馈与 3/10/50 断路器属于授权执行核心；safer-alternative/stop 的最终行为统计进入审计分析层。

## ISSUE-006：Permission Core 与不可绕过执行票据（完成）

建立闭集 effects、action/policy/boundary digests、短时 HMAC 执行票据、一次消费 Guard、结构化拒绝错误、反规避反馈、3/10/50 拒绝断路器、精确摘要一次重试 primitive 和 ticket/override 审计。

验收：所有允许路径必须签发票据；缺票、过期、重复消费、摘要不符和认证失败均在工具体前关闭执行；23 个离线测试通过。

## ISSUE-007：独立 Agent/Session Reviewer

把 one-shot provider 替换为独立 Agent/Session，禁用工具、网络、MCP、插件和委派，只提供紧凑分层 transcript、精确动作、策略与沙盒事实；固定 90 秒、最多 3 次尝试并验证 provider trust policy。

## ISSUE-008：生命周期、命令与恢复

接入 denied/alternative/stopped/manual/override 生命周期、精确 `/approve` 命令、turn/branch/fork/compaction 状态和冷恢复验证。

## ISSUE-009：RPC、TUI、评估与指标

提供模型审查状态与人工接管界面、shadow replay、动作分流漏斗、拒绝后 safer-alternative/stop 统计和安全评估集。

## ISSUE-005：Linux x86 安全与发布验收

执行 bwrap/Landlock、partial enforcement、HMR、并发、snapshot、real API、packed artifact 和无网络 Docker E2E。

并发门禁已覆盖两个 session 同时申请沙盒升级：每个 `(session, call)` 只消费自己的 `allowed-once`，原生 approval 事件和哈希审计链互不串线。
