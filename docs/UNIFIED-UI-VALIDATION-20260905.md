# 统一包与设置交互验证（2026-09-05）

关联 GitHub #26。候选版本：0.6.0-beta.1，尚未替换 npm 默认通道。

## 已取得证据

- build、TypeScript 类型检查通过。
- Vitest：233 通过、3 跳过。跳过的是需要上游 owner patch 的真实插槽检查。
- 安装器 Node 测试：9 通过，包含三种版本并集选择、校验和、符号链接、拒绝覆盖已有目录。
- 兼容检查 Node 测试：7 通过；未知版本、缺失包、双解析根混装均拒绝启动。
- packed consumer 离线导入和原始锁文件离线重放通过。
- 同一 tgz 对 rc6、rc2、alpha5 逐一执行官方 plugin add、检测实际八个宿主包版本和 dump-config，通过。此项不代表三套系统端到端审查均通过。
- rc2 全新 profile 的 WebUI 用浏览器实际操作：打开设置、将 maxAttempts 从 3 改为 2、出现未保存状态、保存成功、刷新重新打开后仍为 2；仅该字段成为用户覆盖。
- rc2 profile 中通过 smoke-installed-native：canonicalWire=approved、irSchemaVersion=1。使用与 npm 公开桥接包匹配的 root-owned runtime，没有放宽可写性或来源校验。

## 发现并处理的问题

- 旧测试 host 的 DSH CLI 虽被固定，内部依赖仍漂移到了 rc8/rc1；重新固定完整公开 family 后再做安装验证。
- 旧 host 缺少 scope、timeout 等模块，dump-config 无法发现；已补齐隔离宿主并真实启动 rc2 WebUI。
- 初次桥接测试选择了不同 provenance 的旧 runtime，正确拒绝；切换到与公开 npm 工件匹配的受保护 runtime 后通过。
- DSH rc2 不接受任意 host 地址，只接受 loopback/all-address。测试绑定 loopback，经 SSH 隧道访问，没有开放公网端口。
- 设置状态、并发保存锁定、失败保留输入、单字段 patch、Full Access 行为说明已覆盖。

## 尚未宣称完成的范围

- 三版本真实模型审查、失败恢复和卸载的完整矩阵尚未完成。
- 原版 DSH 没有工具徽标/设置导航 SVG 的 owner slots；浏览器实际仍显示默认设置图标。配套补丁不能冒充原版开箱即用能力。
- 本次没有调用模型 API，不能报告本次真实模型 token 成本。
- 单包只支持列明并验证的三种 DSH 版本；未知未来版本不会自动猜测兼容。
- GitHub Actions 执行结果以实际 workflow 状态为准，不能仅凭工作流文件存在判定通过。
