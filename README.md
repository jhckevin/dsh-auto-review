# DeepSeek Harness Auto Review

面向 DeepSeek Harness 的原生 Auto Review Bundle。首个支持目标为 Linux x86_64。

当前版本：`0.1.0-dev.0`。

本项目不把 Auto Review 定义为“自动放行”。它在 DeepSeek Harness 原生工具管线中完成确定性动作分类、隔离模型审查、一次性用户审批回退、Linux 文件沙盒约束与可重放审计。

## 原生接入点

- `tools/pre-execute`：对已经校验、快照和冻结的最终工具参数做路由；
- `ctx.tools.guard()`：固化任何后续插件都不能推翻的同步硬拒绝；
- `ctx.sandboxPolicy` / `ctx.sandbox`：读取并执行 Linux 文件效果边界；
- `ctx.approval`：处理必须由用户一次性决定的动作；
- `ctx.llm.prepareCall()`：执行无工具、无 Agent session 的隔离 reviewer 请求；
- `session/event`：记录可恢复、可审计、但不重复进入模型上下文的决定事实；
- `tools/result`：关联最终真实执行结果。

## 不迁移的 Pi 机制

Pi 版 execution ticket 不原样复制。DeepSeek Harness 已经在执行前冻结参数、分配不可伪造的 execution token，并把 `allowed-once` approval 放在同一个工具管线内；再维护一套 ticket store 会制造双重身份和双重生命周期。

## 许可证

MIT。项目不署名或宣传任何 Codex/GPT 生成关系。
