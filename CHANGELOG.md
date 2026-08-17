# Changelog

## Unreleased

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
