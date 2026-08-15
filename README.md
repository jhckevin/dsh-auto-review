# DeepSeek Harness Auto Review

面向 DeepSeek Harness 的原生 Auto Review Bundle。首个支持目标为 Linux x86_64。

当前版本：`0.2.0-dev.2`。

本项目不把 Auto Review 定义为“自动放行”。它在 DeepSeek Harness 原生工具管线中完成确定性动作分类、隔离模型审查、一次性用户审批回退、Linux 文件沙盒约束与可重放审计。

## 原生接入点

- `tools/pre-execute`：对已经校验、快照和冻结的最终工具参数做路由；
- `ctx.tools.guard()`：消费一次性执行票据，并固化任何后续插件都不能推翻的拒绝；
- `ctx.sandboxPolicy` / `ctx.sandbox`：读取并执行 Linux 文件效果边界；
- `ctx.approval`：处理必须由用户一次性决定的动作；
- `ctx.agents.create()`：为每次审查建立独立 Agent/Session，并在完成后销毁；
- `ctx.actionReview` 审计 seam：记录不进入模型上下文的 hash-linked 决定事实；默认 JSONL sink 每条同步落盘并 fsync；
- `tools/result`：关联最终真实执行结果。

显式携带 `sandbox_permissions` 的 bash/fs 调用是一级 `sandbox-escalation` 动作。每个获准动作在 `tools/pre-execute` 取得短时执行票据；票据绑定 action、policy、sandbox boundary 和 call digest，由 `ctx.tools.guard()` 在工具体之前校验并消费一次。自动批准的 sandbox escalation 仍必须以相同 session、call、tool、目标 mode、justification 通过原生 `approval/request` 换取一次 `allowed-once`。`manual/unavailable` 委托原生人工应答者；拒绝时工具体不运行。

## Bundle 角色

同一个安装包公开五个可独立装卸的 Cordis 角色：

- `@jhckevin/dsh-auto-review`：`ctx.actionReview` capability definition；
- `@jhckevin/dsh-auto-review/llm-provider`：隔离 LLM reviewer provider；
- `@jhckevin/dsh-auto-review/policy`：工具管线 consumer 与路由策略。
- `@jhckevin/dsh-auto-review/audit-jsonl`：同步、hash-linked、按运行实例分段的本地 JSONL audit sink。
- `@jhckevin/dsh-auto-review/command`：提供精确动作 `/approve` 人工命令。

`cordis.patch.yml` 只负责组合这四个角色。profile 可以替换 reviewer 或 audit sink、关闭 policy，或切换 `shadow/enforcing`，而不修改实现。

其他高级插件通过 `ctx.actionReview.registerToolSecurityDescriptor()` 声明闭集 effects、分类和 policy rule。工具名只能由一个 descriptor 占有；冲突会使插件加载失败，卸载/HMR 会撤销贡献。兼容 API `registerActionSemantics()` 只提供粗粒度分类。部署 hard-deny 与显式 sandbox escalation 始终优先于外部描述，避免扩展把硬边界重分类为快速路径。

## 当前动作路由

- 普通 workspace 内读取与非破坏性编辑：保留原生快速路径；
- shell/process、网络、敏感路径、删除覆盖、权限与 production 资产：进入 Auto Review；
- 明确请求扩大原生 sandbox 的调用：作为 `sandbox-escalation` 审查，并仍由 DSH 原生沙盒执行；
- 未知 extension tool：默认进入原生 manual approval；
- 部署显式 hard-deny 工具：由 `ctx.tools.guard()` 单调拒绝；
- reviewer 缺失、超时、异常或协议错误：fail closed，回退原生 manual approval，绝不自动放行。
- 同一回合连续三次拒绝，或最近五十次审查中十次拒绝：暂停自动审查并要求用户决定；
- 精确 override：只匹配同一 action digest，只有一次重试机会，重试仍经过完整票据校验。

每个进入管线的动作都会形成 `routed` audit record；实际调用 reviewer 时形成 `decision`；票据签发和消费形成 `ticket`；精确授权形成 `override`；最终冻结结果形成 `result`。记录由 action digest、call/root-call id 关联，并通过 `previousDigest/recordDigest` 串成不可静默改序的链，可直接统计 workspace 内动作、自动审查、自动批准、拒绝、人工回退与最终成功/失败，而无需解析自然语言日志。

拒绝后，下一次相同动作记为 `retried-denied-action`，不同动作记为 `continued-with-different-action`，没有后续动作而结束回合记为 `stopped-after-denial`。不同动作只是 safer-alternative 候选，最终是否属于安全替代由离线评估器判定，运行时不把字符串差异伪装为安全证明。

Reviewer Agent 的 system prompt 和 runtime context 由 provider 权威替换，工具可见集为空，模型选择固定为 reviewer 配置。每次尝试使用新的 Session；单次审查总超时默认 90 秒，最多三次尝试。紧凑 transcript 逐条标记信任级别，只有直接用户消息可作为授权，模型文本、工具输出和动作参数均是不可信证据。完成、失败、超时或取消都会销毁 reviewer Agent/Session。

隔离范围是模型可见与模型可调用能力：reviewer 不获得 filesystem、shell、network、MCP、memory 或 delegation tool。进程内 Cordis 插件和 LLM adapter 属于受信任计算基；能修改全局 Agent 生命周期或 request waterfall 的宿主代码不在本插件可防御的攻击者范围内。

Harness rc.6 的持久化读取器明确没有下游插件事件类型注册面，未知且未标记 `ignorable` 的 Session event 会导致冷恢复拒绝；而公开 `Session.append()` 又不能为下游事件设置该信封位。因此本插件不伪造或 monkey-patch `KNOWN_SESSION_EVENT_TYPES`，也不把审计塞入语义错误的内置事件。审计使用正式 capability/provider 分层和独立存储，原生 `approval/asked`/`approval/decided` 仍由 Harness Session Log 权威持久化。

JSONL provider 启动时验证每个历史文件的完整 digest chain，并在上限内重放 decision、override 与 post-denial 状态。冷恢复只恢复相同 session id；fork 使用新 session id，绝不继承拒绝计数或一次性授权；compaction 保持 session id，但新的 turn 自然获得独立拒绝窗口。审计损坏、链断裂或重放超预算会使插件加载失败。

`/approve [latest-action-digest]` 只能匹配该 session 最后一次真实拒绝。授权只消费一次；下一次同 digest 重试仍调用 reviewer，并把人工授权作为受信任证据。它不跳过 hard policy、票据验证或 native sandbox。

## 执行票据

执行票据不替代 DeepSeek Harness 的 execution token。token 是进程内调用身份，票据是在该身份上附加的授权证明：它带 HMAC、到期时间、一次性 nonce、action digest、policy digest、boundary digest 和 call id。任何缺票、过期、摘要不符、重复消费或认证失败都会在原生 Guard 阶段关闭执行。

## 许可证

MIT。
