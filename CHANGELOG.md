# Changelog

## 0.3.0

- 增加 DeepSeek Harness 原生 WebUI 设置页，支持启用开关、Flash/Pro 模型选择和有界高级参数，默认使用 Flash。
- 以专用 Typert Remote 服务承载设置读写，加入闭集字段、revision 并发控制与 reset，不暴露凭据和宿主路径。
- 对齐 Harness 原生 `read`、`write`、`edit` 工具名；workspace 内读取保持 fast path。
- Flash reviewer 默认使用受支持的 `reasoningEffort: off`，并兼容可选字段的 `null`/空字符串表示，同时继续拒绝多 JSON 和未知键。
- 增加真实 WebUI、Flash reviewer、一次性 ticket、Obelisk extension semantics 与无公网端口验收。

## 0.2.0

- 建立闭集 action/effect 模型、确定性路由和 action/policy/boundary 摘要；
- 使用 HMAC 短时一次性票据绑定 DSH execution token，并在原生 guard 消费；
- 为每次审查创建无工具、独立 prompt、独立 Session 的短生命周期 reviewer Agent；
- 接入 native manual approval、精确 `/approve` 重审、3/10/50 拒绝断路器和反规避反馈；
- 提供 hash-linked JSONL 审计、冷恢复、`/auto-review` 状态面和离线漏斗 evaluator；
- 完成 Linux x86_64 Landlock、断网 Docker、洁净 tarball 和 DSH bundle composition 验收。
