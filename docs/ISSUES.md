# 分阶段 ISSUE 路线图

每个 ISSUE 单独分支、单独提交组；关闭前必须重新查看固定 Harness 源码和本 ISSUE 改动。

## ISSUE-017：WebUI 动作漏斗与策略检索遥测（完成）

设置页增加与公开 Auto Review 示意一致的只读动作漏斗：全部动作、原生沙盒内、进入审查、自动批准、拒绝与人工处理。摘要来自 runtime 聚合计数，不暴露 action 参数、用户内容、提示词或策略查询。设置页同时用动态短文明确 Auto Review 开关、sandbox-default-allow 和 read-only/workspace-write/full-access 的组合行为。

每个最终 decision 记录实际 reviewer tier/provider/model，以及 canonical policy outline/search/get 调用次数和返回字节；primary→strong 升级时合并整个审查生命周期而非只统计末次模型。运行时、离线 eval 与 WebUI 都聚合这些成本。构建、76/76 测试、真实策略检索遥测和 SSR 漏斗渲染通过。

## ISSUE-016：拒绝后的等价效果绕过与人工恢复（完成）

新增与 action digest 分离的 `effectDigest`：对结构化 effects、目标路径、网络目标和 shell 命令进行确定性归一化，忽略无实质意义的引号与空白差异，同时保留真实目标差异。拒绝后再提交同 digest 记为 exact retry；语法不同但 effect digest 相同记为 equivalent-effect retry；真正不同的效果才记为 different action。旧审计没有 effect digest 时按 action digest 兼容恢复。

等价效果重试不会再次碰运气调用 Reviewer，也不会静默执行，而是直接进入 Harness 原生一次性人工审批；批准后仍需要绑定 action/policy/boundary/call 的一次性 ticket。统计与离线 eval 新增 `retriedEquivalentEffect`。构建、75/75 测试、等价敏感读取真实工具管线 E2E 通过。

## ISSUE-015：Canonical Guardian 策略与渐进检索（完成）

从固定 OpenAI Codex 源码 commit 完整、逐字节迁入 Guardian `policy_template.md` 与 `policy.md`，保留上游许可证、来源 commit 和 SHA-256 一致性证据。Reviewer 启动提示只装载可信证据、授权评分、基础风险与 outcome 阈值等不可省略核心章节；凭据、数据外传、破坏性操作、安全弱化等详细规则由三个私有只读工具按 outline → search → exact section 渐进展开，避免每次审查注入整份语料。

策略工具只存在于独立 Reviewer Agent 的子作用域，主 coding agent 不可见。内部递归豁免采用运行时 Session 对象身份 WeakSet，不接受可伪造的 session id；Reviewer 销毁时同步撤销。严格响应协议新增 `userAuthorization`，全量构建、73/73 测试、真实 AgentLoop 策略工具调用、Linux x86 原生 sandbox E2E 和 packed-artifact 策略文件检查通过。

## ISSUE-014：通用模型接入与风险分级策略（完成）

模型配置不再绑定 DeepSeek Flash/Pro 名称。设置面直接接受 Harness 已注册的任意 `provider` 路由、provider-owned model id 和可选 reasoning effort，例如 `openai-compatible / gpt-5.6-terra / high`。API key、base URL 等秘密仍由 Host provider 配置持有，不通过 WebUI 暴露。

支持 `single` 与 `risk-tiered`：分级模式可分别配置常规模型和高风险模型、直接进入高风险模型的 action-kind 闭集，以及 primary 返回 high/critical/manual/unavailable/uncertainty 时是否在同一总 timeout 内升级。每个最终 decision 记录实际 provider/model/tier 与升级来源。构建、67/67 测试及 Linux x86 原生 sandbox E2E 通过。

## ISSUE-013：原生 Sandbox Boundary 与权限矩阵（完成）

Auto Review 关闭时完全退出工具路由、guard 和 approval answerer；`danger-full-access` 同样不虚构不存在的沙盒审批边界。新增默认开启的 `sandboxDefaultAllow`：开启时，`read-only` / `workspace-write` 中由原生文件沙盒约束的普通动作不调用 reviewer，敏感读取、网络和明确沙盒升级仍审查；关闭时，沙盒内动作也进入 reviewer，但最终执行仍受原生 sandbox 约束。

验收：覆盖默认 fast path、严格全量审查、disabled no-op、Full Access no-op、原生 escalation 一次性 grant、敏感/网络路由和 WebUI 设置持久化；构建、63/63 测试及 Linux x86 原生 Landlock symlink-escape E2E 全部通过。

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

## ISSUE-007：独立 Agent/Session Reviewer（完成）

把 one-shot provider 替换为独立 Agent/Session，不向模型暴露工具、网络、MCP、memory 和委派能力，只提供紧凑分层 transcript、精确动作、策略与沙盒事实；固定 90 秒、最多 3 次尝试并验证 provider trust policy。进程内 Cordis 插件与 LLM adapter 明确属于受信任计算基。

验收：真实 AgentLoop 测试确认 reviewer 请求工具集为空、主 agent persona 不进入 system prompt、模型与 reasoning effort 固定、结束后 AgentRegistry 与 SessionStore 均无残留；重试使用全新 Session。

## ISSUE-008：生命周期、命令与恢复（完成）

接入 denied/alternative/stopped/manual/override 生命周期、精确 `/approve` 命令、turn/branch/fork/compaction 状态和冷恢复验证。

验收：命令只接受最后一次真实拒绝的 digest，消费一次后仍重新审查；拒绝后的相同重试、不同动作和回合结束分别留痕；JSONL provider 验证历史 digest chain 并恢复同 session 状态，fork 不继承，compaction 按新 turn 重置拒绝窗口。

## ISSUE-009：RPC、TUI、评估与指标（完成）

提供模型审查状态与人工接管界面、shadow replay、动作分流漏斗、拒绝后 safer-alternative/stop 统计和安全评估集。

验收：`/auto-review` 经原生 CommandRuntime 同时进入 TUI/RPC；运行期和冷恢复均折叠 session/global 指标；离线 evaluator 重建漏斗并检测 route/decision/result/ticket 关联异常；拒绝后精确重试、不同动作候选与停止分别统计。shadow 模式保留 reviewer 原始结论，执行态批准以 `AR-SHADOW` 明确区分。

## ISSUE-005：Linux x86 安全与发布验收（完成）

执行 bwrap/Landlock、partial enforcement、HMR、并发、snapshot、real API、packed artifact 和无网络 Docker E2E。

并发门禁已覆盖两个 session 同时申请沙盒升级：每个 `(session, call)` 只消费自己的 `allowed-once`，原生 approval 事件和哈希审计链互不串线。

最终验收：Linux x86_64 断网测试 38 项通过；真实 Landlock `partial` enforcement 下 workspace 写入成功、symlink 逃逸被拒绝；uncooperative reviewer 的总超时和调用者取消均能终止等待并销毁 Agent；3/10/50 滚动拒绝窗口覆盖交错拒绝；tarball 洁净安装、断网导入和原生 `dsh --dump-config` 组合通过。real-provider 是部署凭据门禁，不是发布包完整性前置条件。
