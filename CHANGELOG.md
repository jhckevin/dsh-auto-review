# Changelog

## Unreleased

## 0.5.2 - 2026-08-18

- Auto Review 设置选项卡使用与审查状态一致的 canonical shield-terminal SVG；Harness 设置插槽原生支持插件自有导航图标并保留未知插件的默认回退。
- 为模型分级、Provider、reasoning effort、升级、高风险类型和高级证据/重试/熔断参数增加中英文就地辅助说明。

## 0.5.1 - 2026-08-18

- 统一 Auto Review 产品标识：设置页、审查中状态与拒绝状态共用既定 shield-terminal SVG；拒绝态仅额外叠加红色斜杠。

## 0.5.0 - 2026-08-17

- 增加统一生产门禁：构建、77 项测试、Guardian 来源摘要与 npm packed artifact 离线洁净导入。
- 增加 256 动作并发压力测试，验证 session 隔离、唯一 action digest 与 hash-linked audit 顺序。
- 增加 Ubuntu 24.04 / Node 24 CI；发布前必须通过无网络、只读、无 capability 的 Linux x86 Docker 测试。
- WebUI 设置页新增内容隔离的动作漏斗与动态权限组合说明，对齐 inside-sandbox / auto-reviewed / approved / denied / manual 分支。
- 最终决策记录 policy outline/search/get 调用次数与返回字节；两级模型升级按整个审查生命周期合并统计。
- 运行时、离线 eval 和 WebUI 聚合策略检索成本，不暴露查询、动作参数或用户内容。
- 新增归一化 `effectDigest` 与拒绝后语义关系审计，区分 exact retry、equivalent-effect retry 和真正不同动作。
- 不同语法重试同一被拒绝效果时不再重复抽样 Reviewer，改走 Harness 原生一次性人工审批与完整 ticket 校验。
- 运行时和离线评估新增 `retriedEquivalentEffect`，旧审计缺少 effect digest 时兼容回退。
- 完整迁入固定版本的 Codex Guardian canonical policy/template，并记录 Apache-2.0 来源与逐字节摘要。
- Reviewer 改用核心规则常驻、详细风险规则按 outline/search/get 渐进检索，私有策略工具不暴露给主 agent。
- Reviewer Session 使用对象身份注册并在销毁时撤销，防止私有策略工具递归触发 Auto Review 或被伪造 id 绕过。
- 严格决策协议新增 `userAuthorization` 评分，风险与授权之后才派生 allow/deny。
- 模型配置改为通用 Harness provider/model/reasoning-effort，不再局限于内置 Flash/Pro 名称。
- 新增单模型与风险分级策略；可配置常规/高风险 profile、强模型 action kinds 和不确定结论升级。
- 最终审查决策记录实际 reviewer tier、provider、model 及二次升级来源；WebUI 不接触 provider 凭据。
- Auto Review 关闭后完全回到 Harness 原生工具与审批链，不再隐式批准、路由或硬拒绝动作。
- `danger-full-access` 不再进入 Auto Review；设置页明确该权限档位没有原生沙盒审批边界。
- 新增默认开启的“原生沙盒内默认通过”设置；关闭时可让 confined actions 也进入 reviewer，执行仍由原生 sandbox 约束。
- 普通 sandboxed process 改走原生 fast path；敏感路径、网络动作和显式 sandbox escalation 继续审查。

## 0.4.1

- 修复 shell 参数中的 `.ssh` 路径被网络命令正则误分类为 `network` 的问题。
- 对配置的敏感路径标记执行命令级检测，并让 `sensitive-read` 优先于网络路由。
- 收紧 `ssh`、`curl`、`git push` 等网络分类的命令段边界，避免普通参数和文本误命中。

## 0.4.0

- 为 Harness 核心 Tool call tree 增加原生、可组合的 `tool.call.badges` list slot，不替换既有或第三方 tool renderer。
- 仅为真正进入 reviewer 的动作投影 `reviewing`/`denied` 状态；批准、人工回退、不可用、shadow 放行和普通沙盒内动作不显示误导性标记。
- 使用 Codex Desktop Auto Review 的 shield-terminal SVG；拒绝态使用红色并叠加红色斜杠，加入中英文可访问标签和减少动态效果支持。
- 增加按 session 共享的有界状态轮询、冷恢复 denied 投影、RPC 输入校验、精确 call-id 绑定与组合渲染测试。

## 0.3.0

- 增加 DeepSeek Harness 原生 WebUI 设置页，支持启用开关、Flash/Pro 模型选择和有界高级参数，默认使用 Flash。
- 以专用 Typert Remote 服务承载设置读写，加入闭集字段、revision 并发控制与 reset，不暴露凭据和宿主路径。
- 对齐 Harness 原生 `read`、`write`、`edit` 工具名；workspace 内读取保持 fast path。
- Flash reviewer 默认使用受支持的 `reasoningEffort: off`，并兼容可选字段的 `null`/空字符串表示，同时继续拒绝多 JSON 和未知键。
- 增加真实 WebUI、Flash reviewer、一次性 ticket、Obelisk extension semantics 与无公网端口验收。

## 0.2.0

- 建立闭集 action/effect 模型、确定性路由和 action/policy/boundary 摘要；
- 使用 HMAC 短时一次性票据绑定 DSH execution token，并在原生 guard 消费；
- 为每次审查创建无工具、独立 prompt、独立 Session 的短生命周期 reviewer Agent；
- 接入 native manual approval、精确 `/approve` 重审、3/10/50 拒绝断路器和反规避反馈；
- 提供 hash-linked JSONL 审计、冷恢复、`/auto-review` 状态面和离线漏斗 evaluator；
- 完成 Linux x86_64 Landlock、断网 Docker、洁净 tarball 和 DSH bundle composition 验收。
