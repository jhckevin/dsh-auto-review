# DeepSeek Harness Auto Review

受 [Codex-style Auto Review](https://alignment.openai.com/auto-review/) 启发的独立 DSH 插件项目。本项目不是 OpenAI、Codex 或 DeepSeek 的官方产品，也不声称与完整 Codex Guardian 实现等价。

自有代码采用 MIT；引用与移植的第三方内容保留原许可证，见 [NOTICE](NOTICE)、[第三方说明](THIRD_PARTY_NOTICES.md) 和 [许可证目录](licenses/)。当前处于开源前验收阶段，发布阻塞见 [ISSUE-026](docs/ISSUE-026-OPEN-SOURCE.md)。原生桥接已改为独立可打包候选并验证离线安装，但尚未公开发布 npm；热生命周期和保护目录安装方案见 [ISSUE-027](docs/ISSUE-027-HOTPLUG.md)。

| DSH 发布通道 | 精确 DSH 版本 | 插件候选版本 |
|---|---|---|
| npm latest / next（固定兼容基线） | 0.1.1-rc.2 | 0.5.6-rc.2 |
| npm alpha | 0.1.2-alpha.5 | 0.5.7-alpha.1 |

两个候选包不能混装，也不承诺兼容未发布 master。兼容候选版尚非生产发布版；本目录对应表格第一行。安装顺序、匹配的 UI 补丁和公开安装阻塞见 [候选安装说明](docs/INSTALL-CANDIDATE.md)。

面向 DeepSeek Harness 的原生 Auto Review Bundle。首个支持目标为 Linux x86_64。

当前候选版本：`0.5.6-rc.2`，仅匹配 DSH `0.1.1-rc.2`，Node >=24.11.0。表格是已锁定的兼容版本，不代表注册表通道永远不变。

适配范围和未完成门禁见 [ISSUE-025](docs/ISSUE-025-DSH-COMPAT.md)。以下历史生产门禁命名不代表完整 Guardian、WebUI 或生产环境已经验收；本轮未替换线上服务。

本项目不把 Auto Review 定义为“自动放行”。它在 DeepSeek Harness 原生工具管线中完成确定性动作分类、隔离模型审查、一次性用户审批回退、Linux 文件沙盒约束与可重放审计。

## 离线回归与发布前验收

`npm run gate:production` 是历史命名的离线回归入口：构建插件 Host/Client 产物、运行类型与行为测试、核验固定策略文本，并检查安装包离线导入。它不构建完整 DSH WebUI，也不证明真实模型、完整 Guardian 或生产沙盒已验收。公开发布还必须核对许可证、公开依赖安装、真实 API trace 及浏览器设置生效。断网检查与必须访问模型 API 的独立容器分开留证，不以源码可导入代替安装包检查。

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

同一个安装包公开六个可独立装卸的 Cordis 角色：

- `@jhckevin/dsh-auto-review`：`ctx.actionReview` capability definition；
- `@jhckevin/dsh-auto-review/llm-provider`：隔离 LLM reviewer provider；
- `@jhckevin/dsh-auto-review/policy`：工具管线 consumer 与路由策略。
- `@jhckevin/dsh-auto-review/audit-jsonl`：同步、hash-linked、按运行实例分段的本地 JSONL audit sink。
- `@jhckevin/dsh-auto-review/command`：提供精确动作 `/approve` 与会话级 `/auto-review` 状态命令；
- `@jhckevin/dsh-auto-review/eval`：从归档审计重建动作漏斗并检查断裂关联。

`cordis.patch.yml` 组合 capability、reviewer、settings、policy、audit 和 command 六个角色。profile 可以替换 reviewer 或 audit sink、关闭 policy，或切换 `shadow/enforcing`，而不修改实现。

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

WebUI 只在动作实际进入独立 reviewer 时，于对应工具调用右侧显示小号 shield-terminal 标记；审查进行中为中性色并轻微呼吸，拒绝后保留红色标记和红色斜杠。inside-boundary、hard-deny、manual、reviewer 缺失、断路器已打开及已暂停的动作都不会伪装成“正在审查”。客户端按可见 session 共享一个有界轮询器，不把审查证据、提示词或凭据暴露给页面。

设置页提供内容隔离的进程级动作漏斗，显示全部动作、原生沙盒内、进入审查、自动批准、拒绝与人工处理；并显示策略检索调用数和返回字节。页面不返回动作参数、策略 query、用户内容或 reviewer prompt。Full Access 不存在原生沙盒边界；Auto Review 启用且 reviewFullAccess 开启时，除硬拒绝外的动作全部送审，不受 sandboxDefaultAllow 影响。关闭 reviewFullAccess 才将该档位交还原生流程；关闭 Auto Review 则所有档位均不受本插件干预。

拒绝后，下一次相同 action digest 记为 `retried-denied-action`；语法不同但归一化目标与效果相同则记为 `retried-equivalent-effect`，并直接转入 Harness 原生一次性人工审批，避免靠改引号或空白反复抽样 Reviewer；真正不同的效果才记为 `continued-with-different-action`；没有后续动作而结束回合记为 `stopped-after-denial`。不同动作只是 safer-alternative 候选，最终是否属于安全替代由离线评估器判定，运行时不把字符串差异伪装为安全证明。

`/auto-review` 通过 Harness 原生 CommandRuntime 暴露当前 session 的动作漏斗、review 结果、执行结果、票据拒绝、拒绝后行为和 reviewer 延迟；CommandRuntime 已提供 TUI/RPC 的统一 list/execute 面。`evaluateAutoReviewAudit()` 则在不启动 Harness、不访问模型的情况下从归档记录重建同一组指标，并报告 decision/result/ticket 的关联异常。图片中的数量是某次观测值，不是实现常量；实现保证分支语义和可测量性，而不追求固定比例。

Reviewer Agent 的 system prompt 和 runtime context 由 provider 权威替换。主 agent 的工具集全部被遮蔽，Reviewer 只得到三个子作用域私有、只读的 canonical policy 工具：outline、search、exact-section get。核心证据规则、授权评分、基础风险与 outcome 阈值常驻；其余 Codex Guardian 风险规则按需渐进展开，完整原文和固定上游 commit 摘要随包发布。模型可选择任意已注册 Harness provider/model，也可按 action kind 使用 primary/strong 两级策略；provider 凭据不进入 WebUI。每次尝试使用新的 Session；所有尝试和强模型升级共享单次审查总超时。紧凑 transcript 逐条标记信任级别，只有直接用户消息可作为授权，模型文本、工具输出和动作参数均是不可信证据。完成、失败、超时或取消都会销毁 reviewer Agent/Session。

隔离范围是模型可见与模型可调用能力：reviewer 不获得 filesystem、shell、network、MCP、memory 或 delegation tool。私有策略工具只读取随包发布的不可变策略语料；Reviewer Session 的递归豁免按运行时对象身份注册并在销毁时撤销，不能靠伪造 session id 获得。进程内 Cordis 插件和 LLM adapter 属于受信任计算基；能修改全局 Agent 生命周期或 request waterfall 的宿主代码不在本插件可防御的攻击者范围内。

历史背景：最初针对 Harness 0.1.0-rc.6 的实现选择独立审计存储，避免向不支持下游未知事件的持久化读取器注入自定义 Session event。当前版本继续使用 capability/provider 分层的独立审计，而不是修改上游事件白名单；原生审批事件仍由 Harness Session Log 持久化。新版会话接口适配情况见 ISSUE-025，不能将旧 rc.6 限制当作全部新版 API 的结论。

JSONL provider 启动时验证每个历史文件的完整 digest chain，并在上限内重放 decision、override 与 post-denial 状态。冷恢复只恢复相同 session id；fork 使用新 session id，绝不继承拒绝计数或一次性授权；compaction 保持 session id，但新的 turn 自然获得独立拒绝窗口。审计损坏、链断裂或重放超预算会使插件加载失败。

`/approve [latest-action-digest]` 只能匹配该 session 最后一次真实拒绝。授权只消费一次；下一次同 digest 重试仍调用 reviewer，并把人工授权作为受信任证据。它不跳过 hard policy、票据验证或 native sandbox。

## 执行票据

执行票据不替代 DeepSeek Harness 的 execution token。token 是进程内调用身份，票据是在该身份上附加的授权证明：它带 HMAC、到期时间、一次性 nonce、action digest、policy digest、boundary digest 和 call id。任何缺票、过期、摘要不符、重复消费或认证失败都会在原生 Guard 阶段关闭执行。

## 0.2.0 验收边界

- 固定 DeepSeek Harness `0.1.0-rc.6` / 源码 `47f943859bef60e4160492346772ded9b24f765a`；
- 38 项测试在 Linux x86_64、Node 24、断网 Docker 中通过；
- 实际 Landlock 运行验证 workspace 写入、symlink 逃逸拒绝和执行审计关联；本验收主机的旧 ABI 报告 `partial`，该状态被保留而非伪装成 `full`；
- 发布 tarball 在独立目录洁净安装，断网导入成功，`dsh --dump-config` 能组合五个插件角色；
- 测试与运行容器没有端口映射，不形成公网服务。

本项目按公开文档实现可观察行为与安全不变量，不声称复制任何未公开的模型权重、训练数据、内部策略或生产基础设施。

## 许可证

项目自有代码采用 MIT；Codex 派生代码和策略仍适用 Apache-2.0，其他第三方内容按各自许可处理。详见 LICENSE、NOTICE、licenses/ 与 THIRD_PARTY_NOTICES.md。当前未获再分发许可的 Desktop SVG 不得随公开版发布。
