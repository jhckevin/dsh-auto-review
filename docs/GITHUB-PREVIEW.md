# GitHub 工程预发布：0.5.6-rc.4 候选

项目：[jhckevin/dsh-auto-review](https://github.com/jhckevin/dsh-auto-review)。本次发布源代码、测试、下游宿主补丁及经过校验的候选制品；不是 npm 发布，也不是完整 Guardian 或生产稳定性认证。

**本轮候选升级到独立的 native 0.1.0-rc.2，不覆盖旧 rc.1 制品。** GitHub #5 跟踪固定源码、Rust 1.95、受控上游开发流程、真实二进制重建和执行证据绑定。源码许可证材料覆盖 672 个组件；其中 10 项没有原始独立许可证文件，精确发布声明与单列标准全文作为不同类型材料保留，`legalApproval=false`。发行时须以本版本实际执行凭据和双重构建结果验收，不能借旧版绿色状态。旧 tag 与 tgz 不覆盖。制品用于隔离评估和工程复现，不是法律审查或生产认证。

## 支持范围

- Linux x86_64/glibc，Node 24；固定 DSH 0.1.1-rc.2。
- 自动审查插件 0.5.6-rc.4 候选；native host/platform 0.1.0-rc.2。
- rc6 对应 0.5.5-rc.3、alpha5 对应 0.5.7-alpha.3 独立候选；以各 Release 附件为准，不混用 peer 版本。
- rc2 热安装需要首次应用配套宿主补丁并重启；之后新增 bundle 可通过原生 `dsh plugin --profile web add` 接入。rc6/alpha5 仅冷启动兼容不能推导出该组 rc2 热发现补丁可用。
- 已加载 reviewer 可停止/重新启用；已导入宿主代码的升级、删除仍要求重启。停用 reviewer 不应把不可用自动变成批准。

## 安装

先阅读 [完整候选安装说明](https://github.com/jhckevin/dsh-auto-review/blob/v0.5.6-rc.4/docs/INSTALL-CANDIDATE.md) 和 [信任边界与热生命周期](https://github.com/jhckevin/dsh-auto-review/blob/v0.5.6-rc.4/docs/ISSUE-027-HOTPLUG.md)。使用 Release 的 SHA256SUMS 验证制品，独立工作区安装，不与已有生产 profile 混装。

默认 codex-native 需要管理员首次部署受保护平台目录。普通用户可写 profile 不能作为可信二进制根；插件不会自行提权、下载可执行文件或静默改用 legacy-js。此准备不能被“热安装”省略。

源码 checkout 的 lock 使用 `vendor/native-bridge/` 内经校验的桥接候选档案；因此公共 CI 不需要访问不存在的 npm bridge 版本。运行包安装使用明确的本地 tgz overrides，见安装文档。不要把源码 CI 的可复现性当作任何现有用户 profile 都无依赖冲突。

## 历史行为证据（不冒用为新 native 构建验收）

| 范围 | 结果 | 不包含的结论 |
|---|---|---|
| 主插件构建、类型与行为测试 | 214 项通过 | 不等于真实模型判断质量 |
| 桥接 owner / 安装保护回归 | 25 + 12 项通过 | 不等于完整 Guardian 执行系统 |
| native 生命周期 | 33 子进程、8 取消、0 迟到批准，退出 0、OOM=false | 不等于所有恶意插件可强制停止 |
| 普通 Web 追加模块图 | 独立 9/9，真实 Loader 与 HTTP SSE | 不等于完整上游 CI |
| 真实浏览器热安装 | 同一打开的设置页新增入口，无刷新；保存后服务器文件值吻合 | 未执行编码任务或模型 API；未另设保存后的独立 runtime observer |

第一次浏览器热到达失败被保留，修复后再验收通过，详见 ISSUE-027。旧实验的 token/模型指标不混入本次安装测试。此次没有新增付费模型调用。

## 发布与协作

- GitHub #1 对应桥接分发/来源，#2 对应公开 CI，#3 对应文档与候选发布；历史 ISSUE-xxx 是内部模块编号。
- 所有代码变更在独立远程工作区完成，经独立审查后提交；不推送共享仓库其他实验分支或原始会话轨迹。
- 自有代码 MIT；Codex 派生部分 Apache-2.0；DSH 补丁 MIT；其余材料保留各自来源和条款。
- Desktop SVG 按维护者要求标注来源并排除出本项目 MIT 范围。来源说明不是已核实的再分发许可或公共领域声明。
- 受控开发 runner 已实现不等于旧制品已通过执行门禁，也不等于新增完整 Guardian runtime；独立协议桥接、实际执行证据与完整系统范围分别报告。
- 安全问题请勿在公开 Issue 粘贴密钥、会话内容或生产数据。发布说明列明已知限制，使用者需在隔离环境评估后再部署。

本版本不自动替换用户现有服务；所有安装和权限变更需由部署者明确执行。

## 原生源码与伴随材料

Release 的源码及校验清单保留固定来源；以本次 `source-manifest.json` 中的桥接提交为准，上游 Codex 固定 `9f97cb79eb15b38d24c552c56fe24e211ff9cf3a`。源码归档本身不进行二进制发行验收，因此 `releaseEligible:false` 不应被改成成功凭据；实际开发执行、构建复现和包门禁由各自独立的 receipt 提供。上游未修改的源码若复用旧 Release 附件，须由本次清单提供确切下载地址和 SHA256，不能让用户猜文件出处。

本次伴随 `SOURCE-README.md` 与 `SOURCE-SHA256SUMS` 给出源码档、固定上游档及证据入口。历史 allocative 补充来源来自固定上游 `fc41670cf9cfebd86ba597925081577897112c51`，不以其替代本次实际打包的材料/完整执行验收。
