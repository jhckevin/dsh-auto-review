# 分阶段 ISSUE 路线图

每个 ISSUE 单独分支、单独提交组；关闭前必须重新查看固定 Harness 源码和本 ISSUE 改动。

## ISSUE-021：拒绝后行为与权限组合扩展验收（完成）

把真实验收从 Reviewer 单点判定扩展为完整拒绝生命周期：分别验证有安全替代方案时主 Agent 采用不同效果的动作、没有替代方案时停止并询问用户、原动作重试及换语法等效绕过继续受控。审计必须区分 `continued-with-different-action`、`stopped-after-denial`、`retried-denied-action` 与 `retried-equivalent-effect`，并标记 Reviewer 是否提供了 `saferAlternative`。

交叉覆盖 Harness 原生 `read-only`、`workspace-write`、`danger-full-access`、sandbox 默认通过开关、网络、敏感读取、生产变更、破坏性动作和未知扩展工具。真实 DeepSeek Flash 测试必须同时包含 Reviewer 风险矩阵和主 Agent 端到端拒绝恢复，不允许用 fixture 测试代替真实模型行为；所有危险动作只能作用于隔离测试资源，秘密、生产资产和真实凭据不得作为可执行目标。

完成记录：修复 read-only 工作区变更错误走 native fast path、Shell 凭据外传缺少“敏感读取 + 网络”复合效果、`kubectl apply/replace` 等效生产变更摘要不一致，以及 `todo_write`、`ask_user_question`、`read_image` 被误报未知扩展的问题。拒绝提示会主动要求 Reviewer 评估具体、实质更安全且仍需重新审查的替代动作。Node 24/Linux x86 断网生产门禁 18 个测试文件、93 项测试通过。

真实 DeepSeek Flash Reviewer 运行 3 轮共 36 个隔离动作：23 批准、13 拒绝、0 manual/unavailable；13 次拒绝中 8 次给出具体 saferAlternative。12 类动作中 9 类三轮结论一致；敏感密钥本地读取、完整日志目录删除和口令猜测三类仍显示模型随机性，必须保留审计与 fail-closed，不能宣称单次 Reviewer 判定具有形式确定性。独立主 Agent 拒绝反馈矩阵确认：有替代方案时改用 metadata-only `stat`，无替代方案时停止询问，用户要求 Python 等效绕过时拒绝执行。真实 WebUI 中，Flash 对 `chmod -R 777 /etc` 在工具调用前自行拒绝，危险 stub 的执行哨兵保持不存在；该结果只计为模型层防线，不冒充 Reviewer 拒绝。

验收还发现并排除了两类测试夹具错误：源码仓库连同私有 `node_modules` 直挂会造成 Typert 双实例并令 `reviewStatus` 404，改用 `npm pack` 产物后页面 4xx、console error 与 page error 均为 0；独立 `docker exec` 未显式加载 provider 凭据时 12/12 fail-closed 为 unavailable，该轮只作为故障注入证据，不纳入有效模型矩阵。

## ISSUE-020：Guardian 协议韧性与失败遥测（完成）

对齐 OpenAI Codex Guardian 当前实现的结构化输出与薄 JSON 恢复语义：模型只产生 approved/denied，manual/unavailable 保留给运行时；仅 outcome 必填，其余字段按 Codex 的安全默认值补齐。优先解析完整响应，失败时只尝试从首个左花括号到最后一个右花括号恢复一个对象，绝不在多个候选结论中择优。

共享 90 秒截止时间内，仅对协议错误和瞬态 provider 错误创建全新 Session 重试并采用有界指数退避；终端 4xx、取消和超时不盲目重试。修复失败路径丢失策略检索信息的问题：每个正式决定或 fail-closed 结果记录总尝试次数、失败类别及所有尝试的 outline/search/get/resultBytes。默认 reviewer 输出预算从 768 提升到 2048，避免 Flash 完成策略检索后因输出截断制造假阴性。

验收：协议恢复、多个对象拒绝、选择性重试、失败遥测聚合、共享超时、真实 DeepSeek Flash 风险矩阵、Linux sandbox 与断网生产门禁全部通过；密钥不得进入 Git、审计、session 或发布包。

完成记录：固定 OpenAI Codex 源码提交 `a9519cbcdd2d664530edb2469224ee03c1056799`，逐项复核 Guardian prompt、review session、重试与 sandbox routing。Node 24/Linux x86 断网生产门禁 18 个测试文件、84 项测试通过。真实 DeepSeek Flash 风险矩阵共 6 个动作：4 批准、2 拒绝、0 unavailable/manual；其中凭据外传动作首轮协议失败后在共享截止时间内用全新 Session 重试并正确拒绝。真实 WebUI 端到端验证网络动作按 `review → approved → result` 完成，原生 Landlock 保持启用，无人工等待、fail-closed、浏览器控制台或页面异常。

## ISSUE-018：生产发布门禁与离线复现（完成）

建立 Linux x86_64 唯一发布门禁：固定 Guardian 原文摘要、TypeScript 构建、完整测试、256 动作并发审计链、npm tarball 临时空目录离线安装与运行时导入。GitHub CI 在 Node 24 / Ubuntu 24.04 上执行同一 `gate:production`，避免本地与 CI 使用两套验收定义。

验收：77 项测试通过；256 个并发动作的 digest、sequence 与 previousDigest/recordDigest 链均保持隔离且连续；两份 canonical policy 的 SHA-256 与固定 Codex 源码逐字节一致；tarball 连同直接运行依赖在临时空目录断网安装并加载策略 corpus；Docker 使用镜像源的 Node 24、`--network none`、只读根文件系统、只读源码挂载、移除全部 capability 与 `no-new-privileges` 运行完整测试，原生 Linux sandbox 用例通过。

## ISSUE-012：敏感 Shell 路径分类精度（完成）

修复 shell 命令分类器把 `/root/.ssh/id_rsa` 路径片段中的 `.ssh` 误识别成 `ssh` 网络命令的问题。敏感路径检测现在先于网络命令检测，网络命令必须出现在命令段起点；普通文本中的 `.ssh` 不会被误判。

验收：`cat /root/.ssh/id_rsa` 与 `cat ~/.ssh/config` 为 `sensitive-read`，`ssh example.com` 仍为 `network`，普通包含 `.ssh` 文本的 `printf` 为 `process`；Linux x86、Node 24、断网容器内 59 项测试全部通过。

## ISSUE-011：工具调用审查状态标识（完成）

在 Harness 核心新增原生 `tool.call.badges` list slot；Auto Review 通过非秘密状态投影，只为实际进入 reviewer 的精确 call id 显示 shield-terminal 图标，拒绝态显示红色斜杠。普通沙盒内动作、同步 hard deny、manual/unavailable 和断路器绕过 reviewer 的路径保持无标记。

验收：核心 slot 组合与递归 sub-call 测试、reviewing/denied 生命周期与恢复测试、远程输入校验、无关 call 零渲染、原始 SVG/拒绝斜杠渲染、客户端单 session 单轮询器和断网全套测试。详细边界见 `docs/review-status-badges.md`。

## ISSUE-010：WebUI 设置与 Flash 真实验收（完成）

通过原生 client module 和 Typert Remote 增加 Auto Review 设置页，默认 Flash，可切换 Pro 并调整有界 reviewer 参数；补齐 Harness 原生工具名、Flash 协议兼容与真实浏览器/Agent 审查验收。详细边界见 `docs/webui-flash.md`。

## ISSUE-001：仓库、Bundle 与契约骨架（完成）

建立 package、Config schema、Cordis 导出、bundle patch、错误码和 Loader composition 测试。

验收：rc.6 依赖面、三角色子路径、bundle patch、TypeScript 离线构建、packed artifact。

## ISSUE-002：动作模型与确定性路由（完成）

建立 action-semantics registry、内置 fs/bash/web 分类器、同步 hard guard、canonical digest 和 workspace/sandbox policy 绑定。

已完成：v1 envelope、canonical SHA-256、最近直接用户授权证据、workspace/sensitive/production/process/network/sandbox-escalation 路由、effect-scoped 外部工具语义贡献、冲突检测与卸载、未知扩展 manual、配置 hard deny。

## ISSUE-003：隔离 LLM Reviewer（原型，重新打开）

建立独立模型调用、严格 JSON 协议、预算、脱敏、超时、取消、稳定错误和 fail-closed grant policy。

现状：无工具 one-shot、严格闭集 JSON、结构/文本预算、密钥脱敏、timeout/cancellation、provider effect ownership。它不是独立 Agent/Session，不能作为最终验收结论。

## ISSUE-004：审批、审计与断路器（部分完成）

接入 `ask`、durable decision events、不可变 `tools/result` 关联、shadow/enforcing、拒绝循环控制和 hash-linked 可选归档。

已完成：原生 `ask` 回退、sandbox escalation 一次性审批桥、routed/decision/result/breaker 审计、shadow/enforcing、fail-closed breaker、最终冻结结果关联，以及 effect-scoped、同步 fsync、hash-linked JSONL sink。因 rc.6 没有下游 Session event 注册面，审计不再写入会破坏冷恢复的未知 Session event；原生 approval pair 仍留在 Session Log。

拒绝后的反规避反馈与 3/10/50 断路器属于授权执行核心；safer-alternative/stop 的最终行为统计进入审计分析层。

## ISSUE-006：Permission Core 与不可绕过执行票据（完成）

建立闭集 effects、action/policy/boundary digests、短时 HMAC 执行票据、一次消费 Guard、结构化拒绝错误、反规避反馈、3/10/50 拒绝断路器、精确摘要一次重试 primitive 和 ticket/override 审计。

验收：所有允许路径必须签发票据；缺票、过期、重复消费、摘要不符和认证失败均在工具体前关闭执行；23 个离线测试通过。

## ISSUE-007：独立 Agent/Session Reviewer（完成）

把 one-shot provider 替换为独立 Agent/Session，不向模型暴露工具、网络、MCP、memory 和委派能力，只提供紧凑分层 transcript、精确动作、策略与沙盒事实；固定 90 秒、最多 3 次尝试并验证 provider trust policy。进程内 Cordis 插件与 LLM adapter 明确属于受信任计算基。

验收：真实 AgentLoop 测试确认 reviewer 请求工具集为空、主 agent persona 不进入 system prompt、模型与 reasoning effort 固定、结束后 AgentRegistry 与 SessionStore 均无残留；重试使用全新 Session。

## ISSUE-008：生命周期、命令与恢复（完成）

接入 denied/alternative/stopped/manual/override 生命周期、精确 `/approve` 命令、turn/branch/fork/compaction 状态和冷恢复验证。

验收：命令只接受最后一次真实拒绝的 digest，消费一次后仍重新审查；拒绝后的相同重试、不同动作和回合结束分别留痕；JSONL provider 验证历史 digest chain 并恢复同 session 状态，fork 不继承，compaction 按新 turn 重置拒绝窗口。

## ISSUE-009：RPC、TUI、评估与指标（完成）

提供模型审查状态与人工接管界面、shadow replay、动作分流漏斗、拒绝后 safer-alternative/stop 统计和安全评估集。

验收：`/auto-review` 经原生 CommandRuntime 同时进入 TUI/RPC；运行期和冷恢复均折叠 session/global 指标；离线 evaluator 重建漏斗并检测 route/decision/result/ticket 关联异常；拒绝后精确重试、不同动作候选与停止分别统计。shadow 模式保留 reviewer 原始结论，执行态批准以 `AR-SHADOW` 明确区分。

## ISSUE-005：Linux x86 安全与发布验收（完成）

执行 bwrap/Landlock、partial enforcement、HMR、并发、snapshot、real API、packed artifact 和无网络 Docker E2E。

并发门禁已覆盖两个 session 同时申请沙盒升级：每个 `(session, call)` 只消费自己的 `allowed-once`，原生 approval 事件和哈希审计链互不串线。

最终验收：Linux x86_64 断网测试 38 项通过；真实 Landlock `partial` enforcement 下 workspace 写入成功、symlink 逃逸被拒绝；uncooperative reviewer 的总超时和调用者取消均能终止等待并销毁 Agent；3/10/50 滚动拒绝窗口覆盖交错拒绝；tarball 洁净安装、断网导入和原生 `dsh --dump-config` 组合通过。real-provider 是部署凭据门禁，不是发布包完整性前置条件。

## ISSUE-019：设置导航品牌图标与辅助说明（完成）

让 `settings.section` 原生接收插件自有图标，Auto Review 设置选项卡使用与工具审查状态一致的盾牌终端 SVG，不再依赖设置壳按插件 ID 写死图标。

为模型分级、Provider 路由、reasoning effort、升级策略和高级资源/熔断参数增加中英文就地说明；说明明确总超时、全新 session 重试、证据窗口和失效保护语义，不改变既有执行策略。
