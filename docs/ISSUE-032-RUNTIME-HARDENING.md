# 运行时加固：实施与证据

关联 #32。本记录对应开发分支，尚非 npm 已发布版本，也不是完整生产验收声明。

## 本轮修复

- 原生 Core 报文桥接在 provider 启动和每次付费 Reviewer 创建前做拒绝报文握手；握手不授予权限。模型输出后的桥接检查仍保留。失败时不创建 Reviewer，不通过取消检查绕过故障。
- 普通常规模型与升级模型共享 `maxAttempts`。它是尝试次数上限，不是策略检索所触发的全部 LLM 步数或硬 token 预算。
- `reviewer-usage` 审计事件统一驱动统计。失败、超时与取消走 finally；等待 agent dispose 后采集尾部 usage 和策略工具记录，避免最终 message 与 usage chunk 双计。处置失败不允许批准。
- DSH 的 inputTokens 为未缓存输入；缓存读取、写入独立计数。缺失 usage 或缓存字段明确标为未知/下界，不当作零费用；升级前日志没有的新字段无法补造。
- WebUI 通过原生 slots.inject 声明屏障检测三个插槽，跟随声明卸载恢复。UI 安装器 --check 报告 uiAdapted，未适配给出警告。普通 dsh plugin add 本身尚不等价于执行 UI 适配命令。
- 三个宿主 CI 增加真实 AgentLoop 的中断、并发取消、下一回合恢复以及终端/聊天提示组件测试。

## 已执行验证

- 全套 Vitest、类型检查、构建；具体输出保留在 artifacts/issue32。
- 三个隔离的固定宿主依赖：0.1.0-rc.6、0.1.1-rc.2、0.1.2-alpha.5，各 16 项真实 Loop/终端/组件测试通过。模型和 Reviewer 答案受控，不是自主模型测试。
- UI 安装器 13 项测试通过，包括按版本下载和失败回滚。
- 真实容器的 root-owned bridge：启动/调用前握手成功；将单次测试进程的运行时路径设为不存在时，返回 artifact 失败，付费调用为 0。
- rc2 真实 WebUI 打开设置，显示 UI integration ready，导航使用盾牌。关闭沙盒免审后保存，真实 Flash 执行一次 node --version；审计证实进入 Reviewer、批准、签发/消费票据并成功返回。
- 上述 Reviewer 一次调用已知 3628 tokens：未缓存输入 1129、缓存读取 2432、输出 67。未报告缓存写入完整明细，故不能声明精确总账；UI 与原生事件审计一致。

## 尚未关闭的门禁

- 三版本全部真实浏览器与自主拒绝/实质安全替代/三拒绝矩阵，不能用受控模型测试替代。
- 当前容器 shell 报告 Landlock partial enforcement。上游 sandbox-local 源码将旧 ABI 部分执行显式区别于 full；尚需核验本机 ABI 与承诺边界，不能宣称完整原生沙盒验收。测试服务暂保留沙盒动作也送审。
- 独立旧 HTTP 旁路采集器出现 stream consumer stopped；新主账本并未丢失本次 usage。该旁路采集器不再作为成本 source-of-truth，完整收尾对账仍须补测。
- 受信运行时必须由管理员安装在 root-owned 目录；不自动提权、不把整个 DSH 以 root 启动。不允许把普通用户可写插件目录当成受信执行根。

## 用户安装路径

继续遵循 README 的三步：普通用户安装插件；管理员首次部署独立原生运行时并设置 DSH_AUTO_REVIEW_NATIVE_RUNTIME；停止 DSH 后运行 dsh-auto-review-ui。安装器可用 --check 先验；启动后设置页应显示界面适配已就绪。旧版、混合版本、未运行 UI 适配、升级覆盖适配或槽声明未加载时都可能缺槽。缺槽影响显示，不意味着审查放行。
