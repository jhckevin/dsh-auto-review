# Auto Review 原生迁移架构

状态：Permission Core、独立 Agent/Session Reviewer、精确人工授权、冷恢复与拒绝后行为审计，版本 `0.2.0-dev.2`。

## 固定上游

- DeepSeek Harness：`47f943859bef60e4160492346772ded9b24f765a`；
- Pi Auto Review：`445b0faf2a1af46711bb2c05172449575f5cbede`；
- 首个运行平台：Linux x86_64，Node 版本跟随 Harness。

## 执行流

```text
frozen ToolExecution
  -> canonical effects + authority + action/policy/boundary digest
  -> deterministic router
       in-boundary -> signed one-shot ticket
       review      -> reviewer -> signed one-shot ticket / deny / manual
       manual      -> { kind: ask } -> native ApprovalService -> ticket
       hard-deny   -> structured error + monotonic guard
       sandbox escalation approved
                   -> native approval/request -> allowed-once
  -> monotonic guard verifies and consumes exact ticket
  -> native tool body
  -> native sandbox enforcement
  -> immutable tools/result
  -> redacted audit correlation
```

## Capability seam

### Definition

`ActionReviewRuntime` 拥有动作描述、闭集 effect vocabulary、review request/result、一次性执行票据、拒绝断路器、精确 override、决策审计和 effect-scoped 工具安全描述注册表。`ActionRouter` 负责可复现的闭集动作分类；未知 extension 不猜测语义，转原生 manual。外部 descriptor 以唯一工具名声明 effects 与策略规则，冲突拒绝加载，卸载时撤销；hard-deny 与 sandbox escalation 的内置分类优先级更高。

### Provider

`LlmActionReviewer` 为每次尝试通过 `ctx.agents.create()` 建立独立 Agent/Session。其 scoped tool restriction 为空，system prompt assembly 被替换为 reviewer 专用内容，runtime contexts 与主 agent persona 不进入请求；模型选择固定为 provider 配置。输入包含经过预算和脱敏的 action、分层标记信任来源的紧凑 transcript、sandbox 事实与显式升级目标。参数、命令、路径、模型消息、工具输出和 justification 均不构成用户授权。严格解析一个版本化 JSON object；单次审查总超时 90 秒、最多三次新 Session 尝试，完成或失败后销毁 Agent/Session。超时、取消、adapter failure 和非法输出均 fail closed。

### Consumer

Cordis 插件监听 `tools/pre-execute`，读取冻结的 `ToolExecution.arguments`、调用 router 和 reviewer，并为每条获准路径签发一次性票据。`ctx.tools.guard()` 在工具体之前校验并消费票据；缺票和摘要不匹配均拒绝。显式 sandbox escalation 还监听 `approval/request`，仅消费与同一 session/call/tool/mode/justification 完全对应的一次性自动批准；其他请求全部委托。最终观察只监听不可变 `tools/result`。

## Sandbox 关系

Auto Review 不实现、替代或绕开沙盒。`ctx.sandboxPolicy.resolve({ session })` 是 workspace root 与 mode 的权威来源；bash/fs 工具仍调用 `approveEscalation()` 并将获批 mode 只盖到该次原生执行。Linux backend 的 bwrap/Landlock 才执行边界。`workspace-write` 只约束文件效果，因此网络、进程执行、权限修改和未知外部工具仍需 review/manual。

## 原生化替代

| Pi 机制 | DeepSeek Harness 原生替代 |
|---|---|
| PermissionBroker | `tools/pre-execute` waterfall + monotonic `ctx.tools.guard()` |
| Execution ticket store | HMAC ticket bound to frozen action, policy, boundary, call and opaque execution token |
| 手写用户审批状态 | `ctx.approval` 的 `allowed-once` closed outcome |
| 自定义执行边界 | `ctx.sandboxPolicy` + Linux sandbox provider |
| 独立 Agent reviewer | 每次尝试创建无工具、独立 prompt、短生命周期的 Agent/Session |
| 自定义审计广播 | `ctx.actionReview` hash-linked audit seam + JSONL sink + `tools/result` correlation |

## 模式

- `disabled`：reviewer 返回批准，但确定性 hard-deny 仍保持单调；适合临时关闭模型审查，不表示关闭部署安全策略；
- `shadow`：记录原始建议，在 reviewer 非批准时转换为带 `AR-SHADOW` 的批准；hard-deny 仍保持单调；
- `enforcing`：按路由结果控制调用。

模式由部署配置固定。`/approve` 只针对同一 session 最新的 denied action digest，并为下一次相同动作提供一次受信任证据；该重试仍经过 reviewer、hard policy、票据和原生 sandbox。外部 JSONL 审计通过完整链验证恢复同一 session 的拒绝窗口与未消费授权；fork 的新 session id 不继承状态，compaction 后的新 turn 使用新的 3/10/50 窗口。

## 最低验收

1. unit、真实 Loader composition、keyless snapshot、real-provider 可选 E2E；
2. dispose/HMR 后无 listener、timer、pending review 泄漏；
3. cancellation 到 reviewer 和底层 adapter，等待已启动工作 quiescence；
4. Linux bwrap/Landlock 完整与 partial enforcement 场景；
5. symlink、hardlink、workspace escape、Docker socket、敏感路径回归；
6. reviewer prompt injection、模糊 JSON、多对象、超时和 provider error 全部 fail closed；
7. shadow/enforcing 审计可重放且不保存原始秘密；
8. tarball 安装与 `dsh --dump-config` 验证。
