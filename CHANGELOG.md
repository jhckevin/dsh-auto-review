# Changelog

## 0.2.0

- 建立闭集 action/effect 模型、确定性路由和 action/policy/boundary 摘要；
- 使用 HMAC 短时一次性票据绑定 DSH execution token，并在原生 guard 消费；
- 为每次审查创建无工具、独立 prompt、独立 Session 的短生命周期 reviewer Agent；
- 接入 native manual approval、精确 `/approve` 重审、3/10/50 拒绝断路器和反规避反馈；
- 提供 hash-linked JSONL 审计、冷恢复、`/auto-review` 状态面和离线漏斗 evaluator；
- 完成 Linux x86_64 Landlock、断网 Docker、洁净 tarball 和 DSH bundle composition 验收。
