# ISSUE-033：单包自动适配三个 DSH 版本

## 问题

此前 npm 上的 rc6、rc2 和 alpha5 是三个独立构建。用户必须先知道 Host 的精确版本，再选择插件预发布版本。DSH 的 `plugin add` 只识别 `dsh.bundle.patch`，没有版本选择协议，也不会替插件执行兼容性预检。

## 方案

插件改为单份结构兼容源码，并在核心 Service 构造时从插件根及真实 DSH launcher 根解析 Host 实际提供的八个 DSH 包。只有完整且一致的 `0.1.0-rc.6`、`0.1.1-rc.2`、`0.1.2-alpha.5` 版本族可以启动。

兼容层归一化三个已确认差异：

1. Session 历史从 `events` 迁移到 `snapshotEvents/eventAt`；
2. Settings namespace 从 branded helper 迁移为字符串；
3. Tool-call badge 从共享轮询客户端注入迁移为 HostObservable 注入。

包不使用 `postinstall`，不修改 profile，不携带第二套 DSH。版本专属 peer 仅作 optional 声明，公共 peer 使用三个精确版本的并集。

## 门禁

- 同一份源码分别在三个现成、隔离的 DSH 依赖树编译；
- 每个版本运行 Host 指纹并核对自动选择结果；
- 混装、缺包、未知版本测试必须失败；
- 三个版本分别从 packed tarball 通过 `dsh plugin --profile web add` 安装并完成启动/卸载验证后，才能发布稳定版。

当前 beta 尚未完成生产验收，不能发布为稳定版。此前“全部上述门禁完成”的表述撤回：冷安装、配置组合、指纹和 WebUI 启动不等于真实审查、卸载和失败保护均已验证。

2026-09-05 复查已修复：发布脚本不接受三版本 peer 并集；启动器与插件依赖根版本冲突未被拒绝；设置页保存单字段却覆盖全部继承设置。全新安装后的浏览器实测确认，只修改 maxAttempts 时仅该字段成为用户覆盖值，刷新后保留，其他参数仍继承部署默认值。发布工作流现等待 CI 成功。

配置 DSH_BRIDGE_ARTIFACTS 后 gate:compat 通过；该检查明确报告 nativeBridge=NOT_TESTED、api=NOT_CALLED，不能替代真实桥接测试。未指定桥接 tarball 时离线检查报 ENOTCACHED，是检查前置参数缺失，不是公开 npm 安装失败。

生产阻断项：全新官方安装 profile 直接执行 smoke-installed-native.mjs 报 artifact trust root is writable or has the wrong owner。受保护运行时的部署步骤仍不能省略，不能通过放宽所有者或可写性校验绕过。原版 WebUI 亦缺少 tool.call.badges 和 settings.section.icon 定制插槽；显示设置页不代表审查徽标已完整注入。三个版本的真实审查、失败保护、卸载及完整 UI 路径尚需补齐证据。

本轮未发布 npm、未替换线上服务。日志保存在服务器 /srv/pi-lab-dev/tmp/ar-product-final-configured-gate.log；浏览器测试使用独立临时 DSH_HOME，没有读取或导入用户 API Key。
