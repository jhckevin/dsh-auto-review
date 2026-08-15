# 分阶段 ISSUE 路线图

每个 ISSUE 单独分支、单独提交组；关闭前必须重新查看固定 Harness 源码和本 ISSUE 改动。

## ISSUE-001：仓库、Bundle 与契约骨架

建立 package、Config schema、Cordis 导出、bundle patch、错误码和 Loader composition 测试。

## ISSUE-002：动作模型与确定性路由

建立 resolver registry、内置 fs/bash/web/cordis 分类器、同步 hard guard、canonical digest 和 workspace/sandbox policy 绑定。

## ISSUE-003：隔离 LLM Reviewer

建立独立模型调用、严格 JSON 协议、预算、脱敏、超时、取消、稳定错误和 fail-closed grant policy。

## ISSUE-004：审批、审计与断路器

接入 `ask`、durable decision events、不可变 `tools/result` 关联、shadow/enforcing、拒绝循环控制和 hash-linked 可选归档。

## ISSUE-005：Linux x86 安全与发布验收

执行 bwrap/Landlock、partial enforcement、HMR、并发、snapshot、real API、packed artifact 和无网络 Docker E2E。
