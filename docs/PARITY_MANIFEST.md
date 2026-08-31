# Codex Auto Review 公开源码一致性清单

状态：阻断发布。当前实现不得宣称与 Codex Auto Review 架构或行为 100% 一致。

## 规范基线

- 上游仓库：`openai/codex`
- 镜像拉取：`https://ghfast.top/https://github.com/openai/codex.git`
- 固定提交：`9f97cb79eb15b38d24c552c56fe24e211ff9cf3a`
- 作者时间：`2026-08-31T16:54:36Z`
- 提交者时间：`2026-08-31T17:10:38Z`
- 基线主题：`Preserve Guardian review evidence across compaction (#41879)`
- 目标平台：DeepSeek Harness，Linux x86_64

“100%”仅指上述固定提交中公开可见且列入机器清单的 Auto Review/Guardian 语义，范围横跨 core、`ext/guardian-v2`、`guardian-context`、protocol/schema、app-server 和可见 UI/TUI 生命周期。任何 UI/TUI 排除项也必须逐项写入 N/A 结构性证明。未公开的生产组件（包括 ARC 内部实现）不在可验证范围内，必须在发布说明中单独列为边界，禁止推测或伪造。

上游明确说明 ARC 仍可能在更早阶段阻断动作；公开仓库没有 ARC 决策器、模型、策略或运行时实现，因此不得将“公开源码一致”扩张成“OpenAI 内部生产系统一致”。

## 硬门禁

候选集合的规范语义是 `union(pathRule, contentPattern, mandatoryPaths)`；文档、manifest、生成器和锁定 inventory 必须使用完全相同的定义。

每一行都必须拥有：上游文件与真实符号、移植文件与真实符号、golden/differential 测试的 FQN/源码/blob/status、首次独立审核的 subagent/证据/blob/提交、整改提交、第二个独立 subagent 的复审记录。没有整改时也必须给出绑定审核提交和证据文件的 `noRemediationProof`；任一字段缺失、占位、路径不存在、符号不可搜索或 hash 不匹配即为失败。

上游范围不是人工挑选的十几份文件。`scripts/generate-codex-upstream-inventory.mjs` 从固定提交的 git tree 取“Guardian/Auto Review 路径规则”、“引用关键类型的 Rust 文件”和审批阶段强制直接依赖三者并集，生成 `docs/codex-upstream-inventory.json`。强制依赖包括此前漏掉的 `core/src/hook_runtime.rs`、`core/src/exec_policy.rs`，以及 approvals.rs 直接消费的本地执行、sandbox、MCP、session 和 protocol 类型。当前锁定 267 项；每项均记录分类、理由、上游 git blob hash、唯一 module owner 和 `ported/test/asset/na` coverage role。校验器会现场重新生成并逐字比对，因此不能靠删除模块、文件或 mandatory path 缩小宣称范围。

Coverage 是双向硬门禁：每个 inventory 条目必须归属一个存在的 manifest module，每个 module 必须至少消费一个 inventory 条目。每个 N/A 条目必须通过 `proofId` 指向 `docs/parity-na-proofs.md` 的集中证明，校验 proof 文件 hash 和 anchor；TUI/Bazel 的自动分类本身不能视为证明。N/A 只排除目标技术，不排除可观察行为的 WebUI/打包测试。

| 模块 | 上游规范 | 当前状态 | 发布门禁 |
| --- | --- | --- | --- |
| 中央审批阶段 | `core/src/tools/approvals.rs` | 未移植 | typed action、hooks 优先级、Guardian/User 路由逐状态一致 |
| ApprovalAction | `core/src/tools/approvals.rs` | 未移植 | 7 种：ExecCommand、WriteStdin、Unix Execve、ApplyPatch、McpToolCall、NetworkAccess、RequestPermissions golden |
| 审批协议 | `protocol/src/approvals.rs` | 未移植 | ReviewDecision 与各 action 特殊结果逐字段一致 |
| 动作序列化 | `core/src/guardian/approval_request.rs` | 未移植 | JSON、截断、身份字段与快照一致 |
| Prompt/证据 | `core/src/guardian/prompt.rs` | 未移植 | first/follow-up、trusted evidence、Node REPL、预算与截断一致 |
| Guardian V2 编排 | `core/src/guardian/review.rs`、`protocol/src/openai_models/guardian_v2.rs` | 未移植 | fast decision、同步升级、事件与配置一致 |
| Guardian V2 scorer | `ext/guardian-v2/src/async_scorer/**` | 未移植 | action、authorization、config、sampler、transcript、truncation、trusted skills/tools 全映射 |
| Guardian V2 sync reviewer | `ext/guardian-v2/src/sync_reviewer/**` | 未移植 | 固定提交真实入口 `GuardianExtension`、`prompt::build`、`reviewer_config::prepare`，prompt、模型配置、策略资产与 fallback 一致 |
| Guardian context | `guardian-context/**` | 未移植 | registry、history、transcript、truncation 一致 |
| Review session | `core/src/guardian/review_session.rs` | 未移植 | 复用键、rollover、deadline、cancel drain、cleanup 一致 |
| 跨压缩证据 | `core/src/context/guardian_review_evidence.rs`、`core/src/agent/control/user_authorization.rs`、thread/history/compact 路径 | 未移植 | compaction/eviction 保留、rollback/授权变化失效 |
| 拒绝断路器 | `core/src/guardian/mod.rs` | 未移植 | 3/10/50 与 cyber 1/1/50 状态机一致 |
| 命令规范化 | `core/src/command_canonicalization.rs`、`command_canonicalization_tests.rs` | 未移植 | argv/cwd/environment/permission/tty cache key 一致 |
| MCP 审批 | `tools/approvals.rs`、`protocol/approvals.rs` | 未移植 | amendment、remember/persist、connector metadata 一致 |
| 网络审批 | 同上 | 未移植 | allow/deny amendment、持久化与 telemetry 时序一致 |
| 权限请求 | 同上 | 未移植 | profile、reason、turn identity 与拒绝语义一致 |
| Metrics/events | `guardian/metrics.rs` 及 protocol | 未移植 | terminal status、failure reason、token usage、source tags 一致 |
| 策略资产 | `core/assets/guardian/*.md`、V2 `classifier_instructions.md`、sync reviewer policy | 部分一致 | 固定 commit 哈希、打包物与许可证检查一致 |
| App-server/UI/TUI | Guardian V2 app-server tests、协议事件与可见状态 | 未移植 | 每项 ported 或 N/A 加结构性证明 |
| 上游测试映射 | 所有清单所引用路径中的测试 | 未建立 | fully-qualified test name、source line/hash、状态或 N/A 证明 |

机器事实源由 `docs/parity-manifest.json` 和 `docs/codex-upstream-inventory.json` 共同组成。先运行 `node scripts/generate-codex-upstream-inventory.mjs --repo <pinned-codex-clone>`；普通 `node scripts/check-codex-parity.mjs --upstream <pinned-codex-clone>` 会验证固定提交、重新生成的候选全集、分类、理由、blob、模块上游路径和符号。发布门禁额外传 `--release`，还会拒绝任何非 `complete`/`na` 模块、缺失/不存在的移植路径与符号、不可定位的测试 FQN、测试源码 blob 漂移、占位审核者、缺失审核证据或 blob、无效审核提交、同一人包办两轮审核，以及既无真实整改提交又无显式无整改证明的模块。

## 已确认的旧版偏差

`v0.5.4` 的 `ActionRouter`、HMAC ticket、effect digest、exact override、saferAlternative、渐进策略检索和每次新建 reviewer session 是项目自定义设计，不是 Codex `9f97cb79` 的审批执行核心。这些能力只能在公开源码一致性完成后作为默认关闭的扩展层存在。

旧版在 `danger-full-access` 下直接退出 Auto Review，与 Codex strict auto-review 路径及本项目已确认的 Full Access 全量审查要求冲突。旧版从 session events 倒扫短窗口，也不能替代 `GuardianReviewEvidence`。

## 原生接入约束

适配层只能转换 DeepSeek Harness 与 Codex 的类型和生命周期：

1. 原生 sandbox/approval 已判定需要审批时，由 `approval/request` 进入中央审批阶段；
2. strict 模式由 `tools/pre-execute` 捕获冻结动作并强制进入同一中央审批阶段；
3. hooks 的 allow/deny 必须先于 Guardian/User；
4. reviewer 允许后仍由 Harness 原生 sandbox 执行，适配层不得绕过或替代沙盒；
5. 无法无损构造成 typed ApprovalAction 的未知扩展动作必须 fail closed 到原生人工审批；
6. `disabled` 必须完全委托原生流程；
7. `danger-full-access` 且启用 Auto Review 时走 strict 全量审查，不能因没有 sandbox prompt 而跳过。

## 审核协议

每个 ISSUE 均执行以下序列，且审核者不得是该 ISSUE 的实现者：

1. 主实现提交；
2. subagent 按固定上游 commit 做文件/符号/状态机差分初审；
3. 主实现修复全部 P0/P1，并记录未采纳项理由；
4. 另一轮 subagent 复审实现与测试证据；
5. 远程 Linux x86_64 生产门禁；
6. 单独的中文 Git 提交与 ISSUE 关闭记录。

不得以测试数量、模型演示成功或策略文本相同替代源码一致性证明。
