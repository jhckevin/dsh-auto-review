# ISSUE-034：拒绝熔断硬中断当前回合

GitHub [#12](https://github.com/jhckevin/dsh-auto-review/issues/12)。开发候选 0.5.6-rc.5，固定 DSH 0.1.1-rc.2。旧三个 Release 与线上服务不覆盖；另外两个 DSH 通道尚未回移本改动。

## 规则与原生边界

参考 [官方拒绝/熔断说明](https://learn.chatgpt.com/docs/sandboxing/auto-review#denials-and-failure-behavior)，第三次连续拒绝，或同回合最近 50 次审查中 10 次拒绝，锁定当前 session/turn。不是整个会话生命周期累计，也不是等第四次才停止。非拒绝（包括已完成的 unavailable）重置连续计数，取消/失效 reviewer 结果不计数；shadow/disabled 不触发硬停。provider 故障熔断与拒绝熔断分开，timeout 不自动成为风险拒绝。

第一次拒绝仍返回理由及实质更安全替代/询问用户指引；熔断是后续强制兜底，不自动安排一次模型解释，也不再将该回合转人工审批框。

1. service 先锁定拒绝状态，再发审计，避免同步重入绕过；熔断快照冻结。
2. policy 在 pre-execute、review 完成后、最后 ticket guard 三处拦截。
3. 同步核对原 exec.agent 对象、session、未结束 turn 与 AbortSignal，调用原生 `agent.cancel({kind:'hook', reason}, {keepInbox:true})`。不异步查找替代 Agent，不在自身工具链中 await whenIdle。
4. 原生 Loop 负责取消后续派发和持久化唯一 `turn/end: aborted / hook`，插件不伪造 assistant 消息或自行闭合 Session 事件。
5. signal 合作的在途工具收到取消；迟到批准不能产生实际执行。没有 Agent 的直接工具调用依然被拒绝，但不冒称已中断一个不存在的回合。
6. 不删除会话，保留排队用户输入；新的用户回合可以正常开始。它不是永久锁定 session，也不承诺阻止其他插件新建后续回合。
7. 这不是 OS 强杀：已经运行且忽略 AbortSignal 的第三方工具仍需自行收尾，不保证被瞬间杀掉。

## WebUI

使用原生 `conversation.chat.turnTail`，只识别持久的 native hook 原因前缀 `[AUTO_REVIEW_DENIAL_BREAKER]`，不检查聊天文本。提示为「本轮操作已被自动审查终止」，复用已有盾牌 SVG、红色斜线、可展开详情与 `role=status`。没有额外模型/RPC调用，刷新/重放可以恢复。

该插槽是 first-match chain；本提示 priority=-100，确保熔断回合先显示安全通知。正常 turn 返回 null。熔断 turn 内不声称同时显示被其优先级遮挡的普通附件尾部；不修改宿主插槽语义。该提示无需 tool.call.badges 的宿主补丁，已有工具右侧图标仍遵循原配套补丁限制。

浏览器验收使用实际 React 源组件与持久事件输入，不是完整 DSH Shell 或三个历史通道的全端到端认证。

## 终端 / TUI 限制与配置

固定 rc.2 没有当前可运行的完整 TUI renderer；原生 headless 对 hook abort 退出但不输出原因。因此提供独立终端 notice adapter，不能将其称为完整 TUI 改造。

仅终端 profile 显式加载 `@jhckevin/dsh-auto-review/terminal`。包内提供 `terminal.patch.yml`，可与既有终端 profile 的补丁组合：

```yaml
- insert:
    - id: auto-review-terminal
      name: '@jhckevin/dsh-auto-review/terminal'
      config:
        enabled: true
```

也可以给既有 DSH 启动命令额外传入 `--patch node_modules/@jhckevin/dsh-auto-review/terminal.patch.yml`；不要重复挂载默认 Auto Review bundle。Web profile 不默认挂载终端适配器。

适配器订阅真实 `session/event`，只对符合标记的原生 turn/end 输出 stderr；同 session/turn 去重，卸载自动退订，session disposed 清理。原因与 session 名经过 ANSI/控制字符/双向控制字符清理并限长。不会向模型上下文注入终端提示。

## 分步计划与复核记录

- [x] 读 service/policy/DSH cancel 与 Session 原始类型：保留原生取消路线，取消“paused 后 manual”的旧语义。
- [x] 修改计数、三层执行拦截，再读代码并独立检查：冻结快照、取消结果不计数、同步匹配防误停。
- [x] 读 UI owner 插槽契约与旧 TUI 文档，再实现：采用原生 turnTail；终端单独适配，不虚称不存在的 TUI。
- [x] 真实 Loop 与 Cordis 回归：默认3次、配置阈值、下一用户回合、并行合作取消、迟到批准、持久事件。
- [x] 本地候选门禁：237 项测试、严格类型、政策来源及隔离 packed consumer 通过；真实 AgentLoop 事件已在浏览器组件验收中重放，正常完成/用户取消不误报。
- [ ] 公开 CI：仅在候选分支发布后由 GitHub Actions 验收；未绿色前不能替代本地门禁或宣称已发布。

所有模型/reviewer答案使用确定性测试适配器；Loop、ToolRuntime、取消和Session均真实。未调用付费模型，未修改已发布 native rc2 字节。
