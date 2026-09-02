# ISSUE-025：DSH 0.1.1-rc.2 插件适配

版本：0.5.6-rc.1。目标上游 tag dsh-v0.1.1-rc.2，commit b150a551b8d465e31e418e1b2eaf5e79bbb7d28e。

## 改动与验证

保留该版本的 CallId、Session.events 与 client-runtime 接口；更新 commands.execute 的 images 参数；修正 assistant/tool 历史证据读取为 data.message.content。新增四个真实 Session 证据测试，包括 fork 继承及信任标签。185/185 测试、构建、类型检查、policy 来源校验与离线打包导入通过，58 个锁定 DSH 包均为 0.1.1-rc.2。

## 版本与发布边界

2026-09-03 核对 npm 镜像 dist-tags：latest/next=0.1.1-rc.2，alpha=0.1.2-alpha.5。分别维护分支，不声称一个 tarball 跨不兼容版本可用；未发布 master 提交不是本次稳定适配目标。Node 使用镜像下载并校验 SHA256 的 24.20.0，声明最低24.11.0。

本轮不调用模型 API、不重跑前次真实模型验收、不替换线上服务。构建与离线服务测试不能证明公网 WebUI、完整 Guardian、完整内核沙盒或长稳生产验收。原生 Rust 桥接版本与既有许可证/迁移门禁不因 DSH 升级而自动关闭。

Git 仅在服务器独立 worktree 分阶段提交；本文件是仓库内 ISSUE 记录，尚未创建 GitHub Issue/PR。所有下载、安装、编译、测试发生在服务器，本机仅接收报告/产物副本。
