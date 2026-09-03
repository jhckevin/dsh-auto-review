# ISSUE-026：开源发布材料补齐与保留阻塞

状态：本地修复；未创建 GitHub issue/PR，未上传源码或发布 npm 包。本文是工程发布检查记录，不是法律意见，也不代表生产验收。

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

最终公开范围必须明确区分项目自有 MIT 代码、保留 Apache-2.0 的 Codex 衍生材料，以及尚无分发授权证据的资产。重新构建并核对源码包/运行包/源码映射/计划公开的 Git 历史。获得独立复核及发布授权之前，本分支不公开。
