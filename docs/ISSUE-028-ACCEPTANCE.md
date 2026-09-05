# #28：精简 UI、原生工具徽章和拒绝硬中断

版本：0.6.0-beta.2 候选。GitHub issue：#28。
代码、构建、安装和模型测试均在隔离的 Linux x86_64 服务器进行；
本机只用于浏览器验证、截图和 GitHub 发布传输，没有安装开发依赖。

## 行为

对照 Codex core guardian/review.rs 的拒绝计数与 abort_turn_if_active：
同一回合连续 3 次拒绝，或最近 50 次审查累计 10 次拒绝，触发 DSH 原生 agent.cancel。
第一次拒绝仍要求采用实质更安全的替代方案，否则停下询问用户；
硬中断是不再提供额外主模型轮次的最后兜底。非拒绝重置连续计数。

取消只作用于匹配的活动 session/turn，保留 inbox；旧回合晚到的批准不能放行动作。
shadow 不计入 enforce 的拒绝熔断。重放审计保持相同计数。
前端只接受原生 hook-aborted turn/end 原因，不根据模型输出的相似文字伪造中断。
WebUI 使用原生 turnTail；终端适配器需要单独挂载。

## 本次完成的验证

- 全量构建、生产与测试类型检查。
- 254/254 Vitest 测试通过（包含真实宿主源码 owner 测试，无跳过）。
- 7/7 UI 安装器测试通过：重复安装、还原、全部预检、未知版本、
  制品/备份篡改、临时文件冲突与回滚、未知 CLI 参数。
- 按 lock 中精确 vendored bridge 制品执行离线 packed consumer 导入成功。
- DSH rc2 官方 plugin add → 自动匹配 → dump-config → remove 全流程通过。
- 从 tgz 中运行 UI 安装器，针对真实官方 rc2 包副本：
  check 修改 0，install 修改 2，重复 install 修改 0，restore 修改 2。
- 真实浏览器看到设置选项卡盾牌、精简设置、真实 Flash 审查中的 Bash 行盾牌；
  两次只读 node --version 均完成。截图已替换 README 原图，未使用模拟图。
- 宿主 UI 补丁只改变显示插槽，保留普通/嵌套工具原视图和 fallback。
- 测试容器运行正常，OOMKilled=false，服务仅绑定回环并经 SSH 转发访问。

## 测试中发现并处理

- 两个预先重新打包的 bridge 与原 source lock 哈希不同，离线门禁正确拒绝。
  改用 lock 指定的原始 vendored 制品后通过；没有关闭校验或修改原 integrity。
  公开 npm 安装单独由官方 installer 测试覆盖，不冒称二者字节相同。
- 外部宿主 settings 源码存在，但 jsdom 的 Vite 文件访问范围拒绝加载。
  测试仅在显式给出 DSH_BADGE_PROOF_ROOT 时允许该根目录，随后 owner 测试通过。
- 上下文提取修正见 [Reviewer 上下文与成本](REVIEWER-CONTEXT-COST.md)。

## 仍需明确的边界

原生 Loop 的三拒绝/并发/取消链路测试使用受控模型和 reviewer 返回，
不是新一轮真实 API “连续三次模型拒绝”实验。README 不放这种模拟截图。
实际审核通过路径和真实浏览器盾牌有实测；拒绝 SVG 的原生 owner 渲染有自动化覆盖。
本次未重新进行中等编码任务，成本分析引用明确标记的上一轮冻结数据。
新的 32k/64k 记忆实验、其他两个宿主版本的预编译 UI、
生产默认 npm 通道切换不属于已完成验收。

参考：[Codex 官方拒绝与熔断说明](https://learn.chatgpt.com/docs/sandboxing/auto-review#denials-and-failure-behavior)。
