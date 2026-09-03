# ISSUE-026：开源发布材料补齐与保留阻塞

状态：历史发布检查记录。2026-09-03 维护者已明确授权按来源标注公开到 GitHub；工程预发布范围与最新状态见 [GITHUB-PREVIEW.md](GITHUB-PREVIEW.md)。以下检查保留其当时结论，不因公开源码而改成全量通过。本文不是法律意见，也不代表生产验收；npm 尚未发布。

## 本次已修复

- 根 `LICENSE` 的项目 MIT 文本保持不变。第三方材料不因该文件存在而被重新许可。
- 从本地可验证的 OpenAI Codex Git 对象复制完整 Apache-2.0 `LICENSE` 和完整 `NOTICE` 到 `licenses/CODEX-LICENSE`、`licenses/CODEX-NOTICE`，通过字节比较确认未修改。
- 新增根 `NOTICE`，补充 `THIRD_PARTY_NOTICES.md` 中 `src/codex-parity/` 的来源、Rust→TypeScript 修改说明和编译输出适用范围。详细符号映射沿用现有 `docs/parity-manifest.json`，不提升其完成状态。

## 来源校验

源仓库：https://github.com/openai/codex

政策快照提交为 `04caa22c8220c24b1428dbeaebcb744bf3875771`；TypeScript 移植基线为 `9f97cb79eb15b38d24c552c56fe24e211ff9cf3a`。两次提交的 `LICENSE`、`NOTICE` Git blob 均相同：

| 文件 | Git blob | SHA-256 |
| --- | --- | --- |
| LICENSE | `4606e72e042564097e8780d66c1d4dcb611869bd` | `d17f227e4df5da1600391338865ce0f3055211760a36688f816941d58232d8dc` |
| NOTICE | `2805899d56d0332d175cfc613c67d45d6f006db7` | `9d71575ecfd9a843fc1677b0efb08053c6ba9fd686a0de1a6f5382fd3c220915` |

## 仍未解除的发布阻塞

1. **SVG 权利证据**：当前 UI 仍使用从 Codex Desktop 提取的图形。已有来源说明，但本轮没有取得明确再分发许可，也没有替换图形。不得把补充 Apache 文件理解成授权该桌面资产。等待用户决定后单独处理源文件、构建产物及计划公开的历史。
2. **原生桥接不可开箱获取**：检查时 `@dsh/codex-approval-bridge-host` 和 `@dsh/codex-approval-bridge-linux-x64-gnu` 的 `0.0.0-prototype.5` 本地 manifest 为 `private:true`，npm 官方源和 npmmirror 查询均返回404。这是该次查询结果，不保证远端永久不存在。optional peer 可以不安装，但默认 `codex-native` 不能因此自动工作。缺桥应保持关闭式失败；若提供兼容配置，必须明确选择并标注 `legacy-js`，不能静默降级。
3. **桥接自身发布门禁**：其现有许可证审计仍列12项缺失材料，开发门禁为 pending。本次仅补插件所用上游许可，不修改或批准发布桥接二进制。
4. **npm 包内容尚待接入检查**：本模块不修改 `package.json`。维护者需要将 `NOTICE`、`licenses/**` 与本说明纳入发布文件，并对实际 tarball 逐项核对；源树有文件不代表发布包已包含。
5. **其他第三方材料**：Lucide图形和DSH所有者补丁仍需按最终保留内容核对相应许可。不能把本轮Codex许可补齐表述为全量SBOM已验收。

## 秘密检查的边界

此前对两个分支 HEAD 的103/107个受跟踪文件及共享60个提交的481个可达blob做了常见API密钥、GitHub令牌及私钥格式扫描，未命中。扫描仅针对指定模式，不证明所有秘密、部署信息或历史资产均可公开；最终发布快照与产物仍需独立复核。本次没有读取私有环境文件。

## 后续验收

### 2026-09-03 图标来源标注补充（ISSUE-026G）

用户要求保留图标外观并标注来源。已在 THIRD_PARTY_NOTICES.md 同时覆盖命令
badge 和设置选项卡，区分来源事实、维护者报告的无版权判断、未核实的权利状态
以及项目 MIT 范围。本次没有重绘或替换 SVG，也没有确认第三方权利归属；删除了
旧说明中未经本轮证据确认的权利人断言。标注不等于取得授权，不阻止其他开发与
测试继续，也不据此把整个公开发布门禁改成通过。本次只更新文档，不发布或部署。

最终公开范围必须明确区分项目自有 MIT 代码、保留 Apache-2.0 的 Codex 衍生材料，以及未核实权利状态的资产。重新构建并核对源码包/运行包/源码映射/计划公开的 Git 历史。

### 2026-09-03 GitHub 工程预发布范围

维护者再次明确授权公开。主分支 HEAD 可达 498 个历史 blob（约 7.4 MB）经常见凭据模式扫描未命中，未发现 AI/Codex 联名；此有限扫描不等于绝对无秘密。另行审核新增发布文件，不推送共享仓库其他实验 refs。

原生依赖已改为公开命名候选、源码 CI 通过本地校验档案解析；包内已包含 NOTICE/许可证文件。原有完整 Guardian execution runner 未实现门禁和原始许可证文件缺项记录继续保留，不能因工程预发布称它们通过。Desktop SVG 按维护者要求保留来源、非 MIT 范围和未核实状态说明。完整稳定版、npm 发布及生产适用性不属于本次公开源码的承诺。
