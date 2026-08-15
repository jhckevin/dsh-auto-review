# WebUI 与 DeepSeek Flash 审查器

## 原生接入

Auto Review 通过 DeepSeek Harness 的 client-module 与 Typert Remote 机制提供设置页，不修改 Harness 核心源码。服务端只公开闭集的 `read`、`update`、`reset` 方法；客户端不能读取凭据、宿主路径或任意配置命名空间。

设置页支持：

- 启用或关闭 Auto Review；
- `DeepSeek-V4-Flash` 与 `DeepSeek-V4-Pro`，默认 Flash；
- reviewer 超时、最多尝试次数、最大输入字节、最大输出 token；
- transcript 条目数与字节预算；
- 乐观并发 revision，避免多个页面静默覆盖配置。

Flash 使用 `reasoningEffort: off`。这是模型能力目录声明支持的档位；不支持的档位必须 fail closed，不得回退为未经审查的执行。

## 路由边界

Harness 的原生文件工具名是 `read`、`write`、`edit`，它们与兼容工具名共同进入确定性路由：沙盒内普通读取和非破坏编辑走 inside-boundary；shell/process、网络、敏感路径、权限、删除、生产资产与显式沙盒扩大进入审查；未知 extension 默认进入人工审批；hard deny 不能被 extension 覆盖。

可选 JSON 字段 `saferAlternative` 的 `null`、空字符串和仅空白字符串归一化为“未提供”。其他协议要求仍保持严格：只接受一个 JSON 对象、拒绝未知键、拒绝开放词汇和多对象输出。

## 真实验收

Linux x86_64 的隔离 WebUI 容器中，Flash reviewer 对用户明确要求的 workspace 内 marker 命令给出 `approved`，签发并消费一次性 `auto-review` ticket，工具最终成功；随后原生 `read` 走 inside-boundary。浏览器页面无 console/page error，容器无端口发布。

Obelisk 通过公开 action-semantics seam 注册跨会话读取语义后，8 个检索动作均由 Flash reviewer 审查并批准，没有人工审批或执行错误。该结果只验证集成路径，不代表安全模型质量的统计结论。
