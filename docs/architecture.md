# Auto Review 原生迁移架构

状态：设计基线，版本 `0.1.0-dev.0`。

## 固定上游

- DeepSeek Harness：`47f943859bef60e4160492346772ded9b24f765a`；
- Pi Auto Review：`445b0faf2a1af46711bb2c05172449575f5cbede`；
- 首个运行平台：Linux x86_64，Node 版本跟随 Harness。

## 执行流

```text
frozen ToolExecution
  -> ActionResolverRegistry
  -> canonical action + digest
  -> deterministic router
       in-boundary -> allow
       review      -> isolated LLM reviewer -> allow/deny
       manual      -> { kind: ask } -> native ApprovalService
       hard-deny   -> deny + monotonic guard
  -> native tool body
  -> native sandbox enforcement
  -> immutable tools/result
  -> redacted audit correlation
```

## Capability seam

### Definition

`ActionReviewRuntime` 拥有：动作描述、effect vocabulary、resolver registry、review request/result、稳定错误码和决策审计形状。

### Provider

`LlmActionReviewer` 使用 `ctx.llm.prepareCall()` 固定 adapter/config generation，发送不含工具 schema 的独立请求。输入只包含经过预算和脱敏的 action、用户授权证据、策略版本及必要历史。严格解析一个版本化 JSON object；超时、取消、adapter failure、非法输出、策略不一致和审计失败均 fail closed。

### Consumer

Cordis 插件监听 `tools/pre-execute`，读取 `ToolExecution.arguments`、调用 resolver 和 reviewer，返回 `allow`、`deny` 或 `ask`。同步硬禁规则同时注册为 `ctx.tools.guard()`。最终观察只监听不可变 `tools/result`。

## Sandbox 关系

Auto Review 不决定沙盒边界。`ctx.sandboxPolicy.resolve({ session })` 是 workspace root 与 mode 的权威来源；Linux backend 报告的 `full/partial` enforcement 必须进入策略。`workspace-write` 只约束文件效果，因此网络、进程执行、权限修改和未知外部工具仍需 review/manual。

## 原生化替代

| Pi 机制 | DeepSeek Harness 原生替代 |
|---|---|
| PermissionBroker | `tools/pre-execute` waterfall |
| Execution ticket store | Frozen `ToolExecution` + opaque execution token + one pipeline |
| 手写用户审批状态 | `ctx.approval` 的 `allowed-once` closed outcome |
| 自定义执行边界 | `ctx.sandboxPolicy` + Linux sandbox provider |
| 独立 Agent reviewer | `ctx.llm.prepareCall()` 的无工具独立请求 |
| 自定义审计广播 | merged Session events + `tools/result` correlation |

## 模式

- `disabled`：不注册 policy listener、guard、reviewer 或 audit projection；
- `shadow`：计算并审计建议，但返回下游默认决定，不改变执行；
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
