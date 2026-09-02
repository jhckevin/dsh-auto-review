# Changelog

## Unreleased

## 0.5.6-rc.1 - 2026-09-03

目标 DSH：0.1.1-rc.2；独立兼容分支，未部署线上，未发布 npm。

- 锁定默认 latest 发布版本，保留此版本原生 Session、CallId、client-runtime 接口。
- 修复 assistant/tool 审查证据读取并补充真实 Session/fork 回归；更新命令 images 参数。
- 全部测试纳入严格类型检查；185 项测试、构建和离线打包通过。

## 0.5.5-rc.1 - 2026-09-02

- 修复 Full Access 开启 Auto Review 后仍跳过审批；新增默认开启的独立 reviewFullAccess 设置，明确它是产品扩展而非 Codex 原生沙盒语义。
- 修复 Full Access escalation 在审批不可用时可能跳过询问的分支；shadow 不再将 manual/unavailable 改成自动批准。
- 修复未知扩展转人工未计入 manual；真实人工转交与测试模拟回复分开解释。
- 在最终 reviewer 决定和执行票据之间接入 prototype.5 的真实 Core ReviewDecision Rust serde 门禁；桥接失败不重试模型、不回退 JS 批准。
- 新增原生决定不匹配、取消、释放失败和 provider fail-closed 回归；扩大测试类型检查，原生沙盒测试使用工作区唯一目录且不伪造平台探针。
- 179/179 单元、8/8 SSE helper、构建、政策来源与离线打包检查通过。真实 Flash 单轮18请求，原9场景全通过，新增拒绝后询问通过，安全替代例直接避险而未触发拒绝分支。
- 保持 RC：不宣称完整 Guardian 迁移、完整沙盒隔离、长期稳定性或生产上线；Linux Landlock 仍为 partial。

## 0.5.4 - 2026-09-01

- 扩展拒绝后生命周期测试，区分采用实质更安全的动作、无替代时停止询问、原动作重试与等效效果绕过。
- 修复 read-only 工作区变更路由、凭据外传复合效果、`kubectl apply/replace` 等效摘要及生产命令识别。
- 将 `todo_write`、`ask_user_question` 识别为无外部副作用的原生控制动作，并让 `read_image` 复用有界读取规则，避免误入未知扩展人工审批。
- Reviewer 拒绝时主动评估具体、低风险且仍需重新审查的 safer alternative；真实 Flash 三轮 36 动作稳定性矩阵与主 Agent 拒绝反馈矩阵纳入验收。
- 生产式 packed WebUI 验证消除 Typert 双实例造成的 `reviewStatus` 404；Linux x86 断网生产门禁共 93 项测试通过。

## 0.5.3 - 2026-08-31

- 对齐 OpenAI Codex Guardian 的结构化输出协议：模型仅返回 approved/denied，仅 outcome 必填；manual/unavailable 只用于运行时状态。
- 使用完整解析优先、首个左花括号至最后一个右花括号的薄 JSON 恢复；拒绝多个对象和未知字段，不从候选结论中择优。
- 在共享 90 秒截止时间内只重试协议错误与瞬态 provider 错误；终端 4xx、取消和超时直接 fail closed。
- 聚合全部 reviewer 尝试、失败类别和策略 outline/search/get/resultBytes 遥测，失败结果不再丢失检索成本。
- Flash 默认输出预算提高到 2048；真实 DeepSeek Flash 风险矩阵、WebUI 网络审批闭环、Linux sandbox 与断网生产门禁通过。

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
