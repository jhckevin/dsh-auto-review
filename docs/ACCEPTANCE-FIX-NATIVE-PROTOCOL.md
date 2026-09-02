# v0.5.5-rc.1 原生Core决议门禁接入

本地ISSUE记录；未发布GitHub issue、未发布生产版本。

## 已修执行链

此前prototype.5从未进入插件运行时。本次将真实调用置于llm-provider最终模型分级决定之后、service签发执行票据之前：

模型自定义JSON校验 → approved/denied映射到Core wire → pinned prototype.5真实Rust serde → 验证并消费IR和canonicalWire → service/policy → 执行票据。

这不是完整Guardian风险引擎移植。prompt、风险分类、DSH决策metadata和适配仍有TypeScript层，不能称100%移植或关闭完整B1。

## 配置

- approvalProtocol 默认 codex-native；bundle显式启用。
- legacy-js 是管理员显式兼容选项，不是失败fallback，不算native验收。
- Linux x64，Node 24+，glibc 2.31+；host/platform须按prototype.5固定provenance安装到root拥有、运行用户不可写的规范路径，进程本身非root。
- optional peer用于让禁用插件/旧兼容部署可安装；native开启而包缺失、权限错误、hash错误时不能自动批准，只能失败关闭转人工。
- native失败位于模型重试和强模型升级之外，不消耗另一轮模型来掩盖基础设施问题。
- 仅接收approved/denied两种映射；会话级、策略修订等其他合法Core变体不是本DSH适配允许的授权。

## 生命周期和记录

同一宿主进程复用一个owner，每次校验创建独立session句柄并在发回决定前释放。插件热切换不关闭共享owner；应用结束时调用导出的shutdownNativeApprovalBridge()（终止性接口，不用于单个会话），进程exit另有同步子进程清理。

native-protocol审计包含reviewerSessionId、parent session关联、固定upstreamCommit、wire/result SHA256、preflight/validated/error。不记录原始拒绝理由到额外native审计中。

## 已验证与仍需验证

- 单元覆盖approved、denied、超时/transport/artifact/serde错误、取消、意外session授权、wire不匹配、session释放失败、不把manual/unavailable映射成批准。
- provider回归验证native故障不重试、不触发strong升级；enforcing及shadow均保持unavailable。
- 上述mock传输单元不等同真实Rust进程；真实Flash与root-owned安装包验证由独立acceptance目录保存。
- Linux沙盒partial enforcement不能由此协议适配修成full；在宿主完整支持之前不得签生产完整隔离验收。
- prototype.5的license-material与upstream-development门禁仍未完成，不得公开分发为生产合格原生包。
