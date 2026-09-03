# DeepSeek Harness Auto Review

[![CI](https://github.com/jhckevin/dsh-auto-review/actions/workflows/ci.yml/badge.svg)](https://github.com/jhckevin/dsh-auto-review/actions/workflows/ci.yml)
[Actions / CI 与发行](https://github.com/jhckevin/dsh-auto-review/actions) · [Release 下载](https://github.com/jhckevin/dsh-auto-review/releases) · [DSH 插件集合](https://github.com/topics/dsh-plugin)

[原生桥接源码与证据门禁](native-audit/README.md)：公开 runner / verifier 源码和固定第三方材料；独立 Actions 校验真实 rc2 安装包、归档的 11 步 Rust/Bazel 执行证据、源码/负面门禁及同 FD 协议 smoke。它不在 GitHub 重新编译 Rust，也不是完整 DSH/Guardian、法律或生产认证。

受 [Codex-style Auto Review](https://alignment.openai.com/auto-review/) 启发的独立 DSH 插件项目。本项目不是 OpenAI、Codex 或 DeepSeek 的官方产品，也不声称与完整 Codex Guardian 实现等价。

由 [jhckevin](https://github.com/jhckevin) 维护。自有代码采用 MIT；引用与移植的第三方内容保留原许可证，见 [NOTICE](NOTICE)、[第三方说明](THIRD_PARTY_NOTICES.md) 和 [许可证目录](licenses/)。此版本作为 GitHub **工程预发布**提供，不是稳定生产认证，也尚未发布 npm。完整安装路径、制品范围及已知限制见 [GitHub 预发布说明](docs/GITHUB-PREVIEW.md)。历史审查记录见 [ISSUE-026](docs/ISSUE-026-OPEN-SOURCE.md)；热生命周期和保护目录方案见 [ISSUE-027](docs/ISSUE-027-HOTPLUG.md)。

| DSH 发布通道 | 精确 DSH 版本 | 插件候选版本 |
|---|---|---|
| rc6 兼容候选 | 0.1.0-rc.6 | 0.5.5-rc.3 |
| rc2 兼容候选（本分支） | 0.1.1-rc.2 | 0.5.6-rc.4 |
| alpha5 兼容候选 | 0.1.2-alpha.5 | 0.5.7-alpha.3 |

三个通道不能混装，也不承诺兼容未验证 master 或未来版本。表格是源码兼容矩阵，不代表候选已经公开发布；以各版本 Release 的实际附件和门禁结果为准。旧 v0.5.6-rc.2 保持原样，不覆盖旧 tag 或制品。安装顺序、匹配的 UI 补丁和前置条件见 [候选安装说明](docs/INSTALL-CANDIDATE.md)。

面向 DeepSeek Harness 的原生 Auto Review Bundle。首个支持目标为 Linux x86_64。

## 安装：先选对 DSH 通道

**不要使用 `npm install @jhckevin/dsh-auto-review`：目前只在 GitHub Release 提供制品。**
一次下载中 `auto-review`、`bridge-host`、`bridge-linux-x64-gnu` 三个 tgz 是一个插件及它的两项依赖，不是三个 DSH 兼容版本。`rc6`、`rc2`、`alpha5` 各自必须有匹配的插件包；尚未出现在 Release 的候选不能靠改包名或强制 peer 安装来代替。

前置条件：Linux x86_64/glibc、Node 24.20.0、npm、tar、sha256sum；在全新目录和独立 DSH_HOME 中测试。不全局安装，不复用生产 profile。native runtime 需要管理员预置在运行用户不可写的目录；**插件不会自行 sudo，也不会在部署失败时降级为自动允许**。

### 1. 按已安装的 DSH 版本下载与校验

以下只下载和校验，不会启动服务；`gh` 使用 GitHub 官方 CLI，公开下载不需要提供模型密钥：

```sh
# 只选一行：不要合并不同通道的下载目录。
TAG=v0.5.6-rc.4       # DSH 0.1.1-rc.2
# TAG=v0.5.5-rc.3     # DSH 0.1.0-rc.6
# TAG=v0.5.7-alpha.3  # DSH 0.1.2-alpha.5
mkdir "auto-review-$TAG-downloads"
cd "auto-review-$TAG-downloads"
gh release download "$TAG" --repo jhckevin/dsh-auto-review
sha256sum --check SHA256SUMS
```

也可以在 [Release 页面](https://github.com/jhckevin/dsh-auto-review/releases) 下载对应通道的全部附件。草稿不是公众可安装版本；若该 tag 尚无公开 Release，请等待本通道发行，不用别的通道顶替。使用下载镜像时，仍必须与本项目 Release 中的 SHA256SUMS 对照。不要将模型 API key 写进下载命令、README 或 profile 的前端配置。

### 2. 管理员预置 native runtime

仅以下步骤在管理员终端执行，工作目录仍为上一步下载目录；管理员应先独立核验平台包校验值：

```sh
sudo install -d -o root -g root -m 0755 /opt/dsh-auto-review-native/0.1.0-rc.2
sudo npm install --prefix /opt/dsh-auto-review-native/0.1.0-rc.2 \
  --offline --ignore-scripts --no-audit --no-fund \
  "$PWD/jhckevin-dsh-auto-review-bridge-linux-x64-gnu-0.1.0-rc.2.tgz"
```

不要以 root 启动 DSH。普通运行用户设置：

```sh
export DSH_AUTO_REVIEW_NATIVE_RUNTIME=/opt/dsh-auto-review-native/0.1.0-rc.2/node_modules/@jhckevin/dsh-auto-review-bridge-linux-x64-gnu
```

### 3. 冷启动与热安装的区别

全新目录测试发现并补齐了上游传递 peer 缺失：公开镜像安装、CLI help/dump-config、loopback HTTP 200、六个插件角色 ACTIVE 已实际通过，没有借用私有祖先依赖图。这只证明冷启动，不代表真实 native 请求、模型风险判断或浏览器热安装通过；证据范围见 [Issue #6](https://github.com/jhckevin/dsh-auto-review/issues/6)。

每个通道的制品目录提供全部运行 tgz、SHA256SUMS、`prepare-preview-install.mjs` 和 `public-dsh-family.json`。rc6/rc2 是十个 tgz；alpha5 另附必需的 `dsh-util-values`，是十一个 tgz。必须使用本通道附带的安装器，不混用脚本或依赖。在该专属下载目录验证校验清单后：

```sh
sha256sum --check SHA256SUMS
node prepare-preview-install.mjs "$PWD" "$PWD/../isolated-auto-review"
cd ../isolated-auto-review
npm install
```

准备脚本只创建不存在的新目录、校验每个包的 SHA 和版本、写固定 peer/本地桥接覆盖；不会执行安装、提权或启动服务。`npm install` 使用生成的镜像设置且不运行 lifecycle scripts。它不适用于缺少单个依赖校验值的旧 rc.2 离线集合；旧包不能通过自行生成新校验清单绕过来源验证。三个 DSH 通道分别验收，不混装。

完整公开 DSH 家族按通道固定：rc6 186 项、rc2 189 项、alpha5 216 项，包括 CLI；使用 exact dependencies + overrides，防止上游 `^` 范围混入其他版本。rc6 的 `node-pty@1.1.0` 没有可用 Linux 预构建文件：在该隔离目录、已有 make/C++/Python 与匹配 Node headers 的条件下，仅执行 `npm rebuild node-pty --ignore-scripts=false --build-from-source`；不要全局开启依赖 scripts。rc2、alpha5 的已验收安装没有这一步。rc6 CLI 没有 `--no-open` 参数，使用时不能照搬 rc2 命令。alpha5 默认启用 Web 鉴权：通过 CLI 输出的官方 launch URL 登录，不要为了测试绕过鉴权。

在已准备完整、同版本宿主与 peer 图的环境，显式加载入口为：

```sh
export DSH_HOME="$PWD/isolated-dsh-home"
node node_modules/@deepseek-ai/dsh/lib/bin.js --profile web \
  --patch node_modules/@jhckevin/dsh-auto-review/cordis.patch.yml \
  --host 127.0.0.1 --port 9835
```

需要对**运行中的 WebUI 热安装**时，还必须先为对应 DSH 源码应用匹配宿主补丁、按上游方式构建并重启一次。之后才使用 `dsh plugin --profile web add`。不能将 rc2 补丁强行用于 rc6/alpha5；目前两历史通道对 rc2 热发现补丁的实际 apply 检查失败。具体依赖、补丁顺序与权限要求见 [INSTALL-CANDIDATE](docs/INSTALL-CANDIDATE.md)、[热生命周期说明](docs/ISSUE-027-HOTPLUG.md)。使用原生 bundle 自动发现后，不要再次叠加手工 `--patch`。

### 4. 验证与回滚

进入设置 → Auto Review，确认模型、权限档位、开关读取和保存；在隔离 workspace 测试沙盒内、送审、拒绝、人工回退各路径，并查看审计实际结果。只看设置页出现或保存成功，不算 native 执行验收。关闭 reviewer 应取消在途请求，不能变成静默批准。移除或替换已加载的 host 代码需要重启 DSH。

测试结束先停止当前 DSH，备份独立 profile 和脱敏审计；回滚时整套恢复对应 DSH、插件和 native runtime 版本。不要删除其他 profile，也不要在运行中的包目录直接覆写 JS。

## Actions、CI/CD 与证据在哪里

- [CI](https://github.com/jhckevin/dsh-auto-review/actions/workflows/ci.yml)：push、PR 或手动触发；检查固定桥接 SHA、镜像依赖安装、build、完整类型、行为测试、策略来源和 packed consumer。
- packed consumer 使用独立空缓存。原 source lock 的复装是另一条门禁：先在新缓存从批准镜像 ONLINE 预取，再在新目录 OFFLINE `npm ci` 重放原锁；不将重新打包的依赖当作 registry 原始制品，也不声称整个 CI 全程断网。
- [Release candidate](https://github.com/jhckevin/dsh-auto-review/actions/workflows/release.yml)：版本 tag/手动触发，固定 commit 后重新验收；生成包、离线依赖、SHA256SUMS、build-receipt。只能生成**草稿预发布**，不覆盖已有 Release；原生/许可证/兼容门禁仍须审核后才公开。
- [Native package and source evidence](https://github.com/jhckevin/dsh-auto-review/actions/workflows/native-audit.yml)：共享 native rc2 的真实包 SHA、材料/来源、11 步开发执行证据及 4 帧 same-FD 协议检查。三个通道使用相同 host/platform 字节；不能把共享桥接检查冒称每个 DSH 通道的完整端到端测试。
- 每次运行的 Artifacts 提供 JUnit、命令日志、成功时的安装包与校验清单，保留 30 天；永久公开版本在 Release。失败步骤不会被改成“跳过即通过”。
- `build-receipt.json` 标明源码 commit/tree、lock SHA、Node/npm 和 Actions run，便于从制品回查构建。源码 CI 不等于真实模型、浏览器或完整原生门禁通过；这些状态分别记录，不能混为一个绿色 badge。

本分支开发候选版本：`0.5.6-rc.5`，匹配 DSH `0.1.1-rc.2`，验证环境 Node `24.20.0`。上方安装命令仍指向已公开的 `0.5.6-rc.4`，不能据此安装本次尚未发布的硬中断改动；另外两个通道尚未回移。表格不代表注册表通道永远不变。

开发候选新增 [拒绝熔断硬中断与终端配置](docs/ISSUE-034-DENIAL-HARD-STOP.md)：第三次连续拒绝或同回合最近50次审查中10次拒绝，通过 DSH 原生取消结束当前回合。WebUI 使用原生回合尾部插槽显示「本轮操作已被自动审查终止」；终端显式加载 `@jhckevin/dsh-auto-review/terminal`（包内 `terminal.patch.yml`）输出同一持久事件的告警。固定 rc.2 没有完整 TUI renderer，因此终端适配器不等于完整 TUI 界面。已有正常会话、下一用户回合及禁用 Auto Review 的行为不改变。

本轮 native rc2 在同一冻结 Debian 11 builder / Rust 1.95 下两次独立空 target、断网构建，二进制逐字节一致（SHA256 `dd6ad6bf0ebec9ae36d40fdaa91dda8aabb21bc3191366a5b0e25b8f5e10888b`）。真实非 root、只读根、断网安装验收为 25 owner 测试 + 13 包模式；来源材料覆盖 672 Rust 组件的 1,350 条引用，launcher 另行绑定 2 个官方 npm 包 / 15 个成员。十项上游原始独立 LICENSE 缺失事实保留；这些工程门禁不构成法律或完整生产认证。固定环境重现不等于任意未来工具链可重现。

适配范围和未完成门禁见 [ISSUE-025](docs/ISSUE-025-DSH-COMPAT.md)。以下历史生产门禁命名不代表完整 Guardian、WebUI 或生产环境已经验收；本轮未替换线上服务。

本项目不把 Auto Review 定义为“自动放行”。它在 DeepSeek Harness 原生工具管线中完成确定性动作分类、隔离模型审查、一次性用户审批回退、Linux 文件沙盒约束与可重放审计。

## 离线回归与发布前验收

`npm run gate:production` 是历史命名的工程回归入口：构建插件 Host/Client 产物、运行类型与行为测试、核验固定策略文本，并分别检查安装包离线导入及原锁镜像预取/离线重装。它不是全程断网，也不构建完整 DSH WebUI，不证明真实模型、完整 Guardian 或生产沙盒已验收。公开发布还必须核对许可证、公开依赖安装、真实 API trace 及浏览器设置生效。断网检查与必须访问模型 API 的独立容器分开留证，不以源码可导入代替安装包检查。

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
- 同一回合连续三次拒绝，或最近五十次审查中十次拒绝：开发候选 rc.5 原生中断当前回合并显示持久告警；此前公开版仅暂停自动审查并转人工审批。非拒绝重置连续计数，第一次拒绝仍要求实质更安全的替代方案或询问用户；
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

项目自有代码采用 MIT；Codex 派生代码和策略仍适用 Apache-2.0，其他第三方内容按各自许可处理。详见 LICENSE、NOTICE、licenses/ 与 THIRD_PARTY_NOTICES.md。Desktop SVG 按维护者要求保留来源说明，不纳入本项目 MIT 授权；本项目没有验证其公共领域或再分发许可状态，也不声称来源标注可以代替许可。
