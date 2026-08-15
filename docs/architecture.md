# Auto Review 原生迁移架构

状态：原生执行闭环与扩展语义注册表，版本 `0.1.0-dev.3`。

## 固定上游

- DeepSeek Harness：`47f943859bef60e4160492346772ded9b24f765a`；
- Pi Auto Review：`445b0faf2a1af46711bb2c05172449575f5cbede`；
- 首个运行平台：Linux x86_64，Node 版本跟随 Harness。

## 执行流

```text
frozen ToolExecution
  -> canonical action + authority + digest
  -> deterministic router
       in-boundary -> allow
       review      -> isolated LLM reviewer -> allow/deny/manual
       manual      -> { kind: ask } -> native ApprovalService
       hard-deny   -> deny + monotonic guard
       sandbox escalation approved
                   -> native approval/request -> allowed-once
  -> native tool body
  -> native sandbox enforcement
  -> immutable tools/result
  -> redacted audit correlation
```

## Capability seam

### Definition

`ActionReviewRuntime` 拥有：动作描述、effect vocabulary、review request/result、断路器、决策审计形状和 effect-scoped 动作语义注册表。`ActionRouter` 负责可复现的闭集动作分类；未知 extension 不猜测语义，转原生 manual。外部 contribution 以唯一工具名声明语义，冲突拒绝加载，卸载时撤销；hard-deny 与 sandbox escalation 的内置分类优先级更高。

### Provider

`LlmActionReviewer` 使用 `ctx.llm.stream()` 发送不含工具 schema 的独立请求。输入只包含经过预算和脱敏的 action、最近一条直接用户消息形成的授权证据、sandbox 事实与显式升级目标。参数、命令、路径和 justification 均标为不可信数据。严格解析一个版本化 JSON object；超时、取消、adapter failure 和非法输出均 fail closed。

### Consumer

Cordis 插件监听 `tools/pre-execute`，读取冻结的 `ToolExecution.arguments`、调用 router 和 reviewer，返回 `allow`、`deny` 或 `ask`。同步硬禁规则同时注册为 `ctx.tools.guard()`。显式 sandbox escalation 还监听 `approval/request`，仅消费与同一 session/call/tool/mode/justification 完全对应的一次性自动批准；其他请求全部委托。最终观察只监听不可变 `tools/result`。

## Sandbox 关系

Auto Review 不实现、替代或绕开沙盒。`ctx.sandboxPolicy.resolve({ session })` 是 workspace root 与 mode 的权威来源；bash/fs 工具仍调用 `approveEscalation()` 并将获批 mode 只盖到该次原生执行。Linux backend 的 bwrap/Landlock 才执行边界。`workspace-write` 只约束文件效果，因此网络、进程执行、权限修改和未知外部工具仍需 review/manual。

## 原生化替代

| Pi 机制 | DeepSeek Harness 原生替代 |
|---|---|
| PermissionBroker | `tools/pre-execute` waterfall |
| Execution ticket store | Frozen `ToolExecution` + opaque execution token + one pipeline |
| 手写用户审批状态 | `ctx.approval` 的 `allowed-once` closed outcome |
| 自定义执行边界 | `ctx.sandboxPolicy` + Linux sandbox provider |
| 独立 Agent reviewer | `ctx.llm.stream()` 的无工具独立请求 |
| 自定义审计广播 | `auto-review/routed/decision/result` Session events + `tools/result` correlation |

## 模式

- `disabled`：reviewer 返回批准，但确定性 hard-deny 仍保持单调；适合临时关闭模型审查，不表示关闭部署安全策略；
- `shadow`：记录原始建议，在 reviewer 非批准时转换为带 `AR-SHADOW` 的批准；hard-deny 仍保持单调；
- `enforcing`：按路由结果控制调用。

模式变化必须以 durable session event 表示；运行时上下文只追加当前语义，不重写 system prompt。

## 最低验收

1. unit、真实 Loader composition、keyless snapshot、real-provider 可选 E2E；
2. dispose/HMR 后无 listener、timer、pending review 泄漏；
3. cancellation 到 reviewer 和底层 adapter，等待已启动工作 quiescence；
4. Linux bwrap/Landlock 完整与 partial enforcement 场景；
5. symlink、hardlink、workspace escape、Docker socket、敏感路径回归；
6. reviewer prompt injection、模糊 JSON、多对象、超时和 provider error 全部 fail closed；
7. shadow/enforcing 审计可重放且不保存原始秘密；
8. tarball 安装与 `dsh --dump-config` 验证。
