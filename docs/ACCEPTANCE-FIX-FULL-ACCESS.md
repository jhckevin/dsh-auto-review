# Full Access 与人工转交验收修复

本地 ISSUE 记录；尚未向 GitHub 发布 issue 或 PR。

本模块是用户要求的产品策略扩展，不宣称是 Codex 原生审批规则的逐字复刻，也不创建或替代 Linux 沙盒。

## 行为

- Auto Review disabled：所有权限模式完全使用 Harness 原生链，不做插件路由/硬禁/审批。
- Auto Review enabled + Full Access：`reviewFullAccess` 默认 true，除部署硬禁直接拒绝外所有动作送审，包括注册描述器声称 inside-boundary 的工具和未知工具。不受 `sandboxDefaultAllow` 影响。
- `reviewFullAccess=false`：仅 Full Access 档位恢复完全原生链（包含插件硬禁不介入），其他权限档位不受影响。
- read-only/workspace-write：保留原有原生沙盒策略；批准不意味着解除沙盒。
- runtime 注册的 reviewer session 按对象身份豁免递归审查；撤销注册后恢复审查。
- shadow：只对明确完成的 denied 决策保留原有观测通过语义；manual/unavailable（含桥接失败）不能改为 approved。
- Full Access 下即使命令携带 require_escalated，manual/unavailable 也必须显式 ask，不能依赖不存在的原生沙盒升级询问。

## 审计口径

`manual` 统计 router 的 manual 路由和 reviewer 的 manual 决策；两条路径互斥，不重复累计。它不是人工最终允许/拒绝数量，也不是 WebUI 点击数量。equivalent-retry 的额外 native 人工转交不包含在本兼容指标中；统计全量人工交互需要单独明确事件口径。

## 定向验收

真实 ToolRuntime 管线、fixture reviewer（不调用 API）：Full Access 两种 sandboxDefaultAllow、批准/拒绝/硬禁、未知工具、disabled 与独立 opt-out、reviewer 递归豁免与撤销、settings 更新/重置、manual 路由和决策各累计一次、shadow manual/unavailable fail-closed。

这不是生产部署、真实模型或浏览器验收。后续需独立 reviewer 复核及固定构建后的 Flash/真实 Linux sandbox 复测。

本轮定向 6 个测试文件、59 个断言用例全部通过；tsc --noEmit 与 git diff --check 通过。未调用 API。最终提交前等待独立复审。
