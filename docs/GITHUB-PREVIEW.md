# GitHub 工程预发布：0.5.6-rc.2

项目：[jhckevin/dsh-auto-review](https://github.com/jhckevin/dsh-auto-review)。本次发布源代码、测试、下游宿主补丁及经过校验的候选制品；不是 npm 发布，也不是完整 Guardian 或生产稳定性认证。

**重要：native 仓库原始完整发行门禁仍为 FAIL。** 其受控执行 runner 尚未实现，原始独立许可证文件审计仍列 12 项。候选包含这些组件的完整原 crate、119 份原始声明/源码材料及注明来源的标准许可全文，但这不等于原始许可文件缺项清零。本次另附 allocative 两组件的精确版本源码/原始许可证据，不覆盖原 tgz、不改旧门禁。其余 10 项不假称已补齐。制品用于隔离评估和工程复现，不能称完整法律审查或生产认证完成。

## 支持范围

- Linux x86_64/glibc，Node 24；固定 DSH 0.1.1-rc.2。
- 自动审查插件 0.5.6-rc.2；native host/platform 0.1.0-rc.1。
- 历史 alpha 适配不随本次发布，不混用 peer 版本。
- 热安装需要首次应用宿主补丁并重启；之后新增 bundle 可通过原生 `dsh plugin --profile web add` 接入，已打开 WebUI 不需要刷新。
- 已加载 reviewer 可停止/重新启用；已导入宿主代码的升级、删除仍要求重启。停用 reviewer 不应把不可用自动变成批准。

## 安装

先阅读 [完整候选安装说明](INSTALL-CANDIDATE.md) 和 [信任边界与热生命周期](ISSUE-027-HOTPLUG.md)。使用 Release 的 SHA256SUMS 验证制品，独立工作区安装，不与已有生产 profile 混装。

默认 codex-native 需要管理员首次部署受保护平台目录。普通用户可写 profile 不能作为可信二进制根；插件不会自行提权、下载可执行文件或静默改用 legacy-js。此准备不能被“热安装”省略。

源码 checkout 的 lock 使用 `vendor/native-bridge/` 内经校验的桥接候选档案；因此公共 CI 不需要访问不存在的 npm bridge 版本。运行包安装使用明确的本地 tgz overrides，见安装文档。不要把源码 CI 的可复现性当作任何现有用户 profile 都无依赖冲突。

## 已验证证据

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
- 原生仓库中完整 controlled execution runner 未实现的开发门禁保持未通过；不能宣称与完整 Codex Guardian 100% 等价。独立协议桥接的通过证据和该完整系统门禁分别报告。
- 安全问题请勿在公开 Issue 粘贴密钥、会话内容或生产数据。发布说明列明已知限制，使用者需在隔离环境评估后再部署。

本版本不自动替换用户现有服务；所有安装和权限变更需由部署者明确执行。

## 原生源码与伴随材料

Release 附件中的 `bridge-source.tar.gz`、`upstream-source.tar.gz` 和 `source-manifest.json` 保留固定来源；源 manifest 的 `releaseEligible:false` 原样保留。桥接源码提交为 `a25421efb28d290e40d84572039be75b94ff2099`，后续归档证据提交 `ac7214b681ca08c999cfe21c870af6a323ff2fd8`，上游 Codex 固定 `9f97cb79eb15b38d24c552c56fe24e211ff9cf3a`。

额外 `allocative-fixed-source-and-licenses.tar`、`allocative-exact-proof.json`、`verify-allocative.py` 来自固定上游 `fc41670cf9cfebd86ba597925081577897112c51`，与发布 crate 的 62 + 4 个源成员逐字节匹配。它们是补充证据，不是修改已冻结二进制或重新签发“全部通过”的凭据。
