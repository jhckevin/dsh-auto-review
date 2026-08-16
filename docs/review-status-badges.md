# 工具调用审查状态标识

## 目标

只标识真正交给独立 reviewer 的命令和工具调用：审查中显示中性色小图标，拒绝后显示红色图标与红色斜杠。普通沙盒内动作和其他未调用 reviewer 的分支不得出现标识。

## Harness 原生接入

核心 `ui-tool` 包声明 `tool.call.badges` session-scoped list slot，并把和 `tool.call.toolview` 相同的冻结 `ToolCallOwnerProps` 交给贡献者。它是纯展示插槽，不执行动作、不改写 Tool 状态，也不接管现有 keyed renderer。工具视图与徽标使用同一 flex 行，徽标始终在右侧并保留摘要截断空间；所有贡献者都返回空节点时，徽标容器不占布局空间。

## 状态边界

- `reviewing`：动作 disposition 为 `review`，provider 存在、拒绝断路器未暂停、失败断路器未打开，并且已准备实际调用 reviewer。
- `denied`：reviewer 的有效执行结论为拒绝；在 enforcing 模式保留到内存上限淘汰或冷恢复重建。
- 清除：approved、manual、unavailable、异常、取消，以及 shadow 模式把原始拒绝转为有效批准。
- 从不创建：inside-boundary、hard-deny、disabled、provider 缺失、断路器打开和回合拒绝暂停。

状态以 `(sessionId, callId)` 精确绑定。WebUI 每个可见 session 共享一个 200ms 有界轮询器；首个徽标挂载时启动，最后一个卸载时终止并取消请求。Remote 只返回 call id、tool name、状态和时间，不返回模型输入、策略证据、凭据或文件内容。

## 图标与可访问性

shield-terminal 路径从用户机器已安装的 Codex Desktop Auto Review 资源中提取并原样使用，缩放到 Harness 24px 网格中的 15px 图标。拒绝斜杠沿用同一资源包使用的 `m2 2 20 20` 几何。图标容器提供中英文 `aria-label`、`title` 与 polite 状态语义；审查中呼吸动画遵守 `prefers-reduced-motion`。

图标的权利声明见 `THIRD_PARTY_NOTICES.md`，它不因本仓库的 MIT 许可证而重新授权。

## 验收门禁

1. 核心 slot 对 root/sub-call 传递正确 call id，且不替换 toolview。
2. 未进入 reviewer 或 call id 不匹配时输出空 HTML。
3. reviewing 使用原始 shield-terminal 路径且无拒绝斜杠。
4. denied 使用同一路径并包含红色状态和斜杠。
5. provider 完成批准后移除状态，拒绝后保留状态；RPC 拒绝空 session id。
6. 客户端同一 session 只启动一个轮询器，卸载后无后台请求；Remote 故障不破坏对话 UI。
7. Linux x86_64 断网执行构建、测试和 packed-artifact 导入。
