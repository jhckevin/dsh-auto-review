# ISSUE-025：DSH 0.1.2-alpha.5 插件适配

版本：0.5.7-alpha.1。目标上游 tag dsh-v0.1.2-alpha.5，commit db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5。

## 改动与验证

改用 ToolCallId、dsh-util-values、Session.seq/eventAt/snapshotEvents、字符串 settings namespace 与 Cordis Context。真实装配补齐 sessionProjections，明确检查 policy fiber ACTIVE。保留 fork 继承证据，修复 data.message.content 读取。新增 never 模式零执行/零人工询问回归，全部测试文件纳入类型检查。compat:check 验证实际安装包及真实服务，不以 lockfile 或 await ctx.plugin 代替激活证据。WebUI 设置与两处 SVG 展示适配参见配套 UI 补丁说明。

## 版本与发布边界

2026-09-03 核对 npm 镜像 dist-tags：latest/next=0.1.1-rc.2，alpha=0.1.2-alpha.5。分别维护分支，不声称一个 tarball 跨不兼容版本可用；未发布 master 提交不是本次稳定适配目标。Node 使用镜像下载并校验 SHA256 的 24.20.0，声明最低24.11.0。

本轮不调用模型 API、不重跑前次真实模型验收、不替换线上服务。构建与离线服务测试不能证明公网 WebUI、完整 Guardian、完整内核沙盒或长稳生产验收。原生 Rust 桥接版本与既有许可证/迁移门禁不因 DSH 升级而自动关闭。

Git 仅在服务器独立 worktree 分阶段提交；本文件是仓库内 ISSUE 记录，尚未创建 GitHub Issue/PR。所有下载、安装、编译、测试发生在服务器，本机仅接收报告/产物副本。
