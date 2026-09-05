# Auto Review for DeepSeek Harness

让需要审批的操作先由独立模型审查，减少反复确认，同时保留沙盒和人工审批。

[下载](https://github.com/jhckevin/dsh-auto-review/releases) · [问题反馈](https://github.com/jhckevin/dsh-auto-review/issues) · [更新记录](CHANGELOG.md)

## 界面预览

![DeepSeek Harness 中的 Auto Review 设置界面](docs/images/auto-review-settings.jpg)

<sub>真实 WebUI 截图，来自 DSH 0.1.1-rc.2 兼容版。</sub>

## 它能做什么

- **减少确认打断**：默认让原生沙盒内的普通操作直接执行，需要扩大权限的操作交给 Reviewer。
- **独立审查**：Reviewer 根据用户授权和风险规则判断是否允许，不替主 Agent 执行命令。
- **拒绝后继续找办法**：主 Agent 可以尝试更安全的方案；无法继续时，再向你请求授权。
- **自行选择模型**：默认 Flash，也可使用 DSH 已配置的其他模型，或为高风险操作单独指定模型。
- **在界面中管理**：开关、模型设置和动作统计都在“设置 → 自动审批审查”中。

## 安装

目前支持 **Linux x86_64（glibc 2.31+）**。建议使用 Node.js **24.20.0**，并选择与你的 DSH 完全对应的插件通道。

### 1. 安装插件

已有 DSH CLI 时，执行其中一条：

| DSH 版本 | 安装命令 |
| --- | --- |
| 0.1.0-rc.6 | `dsh plugin --profile web add @jhckevin/dsh-auto-review@rc6` |
| 0.1.1-rc.2 | `dsh plugin --profile web add @jhckevin/dsh-auto-review@rc2` |
| 0.1.2-alpha.5 | `dsh plugin --profile web add @jhckevin/dsh-auto-review@alpha5` |

通常推荐 DSH 0.1.1-rc.2 对应的 `rc2` 通道。安装命令会自动把 Auto Review 和两个桥接依赖加入 `web` profile，不需要下载 Release 附件或手写 patch。

### 2. 初始化受保护的执行组件

这一步每台机器只做一次。它需要管理员权限，以保证运行 Agent 的普通用户不能修改审查后的执行组件。

```sh
sudo npm install --prefix /opt/dsh-auto-review-native/0.1.0-rc.2 \
  --ignore-scripts --no-audit --no-fund \
  @jhckevin/dsh-auto-review-bridge-linux-x64-gnu@0.1.0-rc.2

export DSH_AUTO_REVIEW_NATIVE_RUNTIME=/opt/dsh-auto-review-native/0.1.0-rc.2/node_modules/@jhckevin/dsh-auto-review-bridge-linux-x64-gnu
```

请在启动 DSH 的同一终端、服务配置或容器环境中保留这个环境变量。没有 sudo 权限时，让管理员完成本步骤；不要改成以 root 身份运行整个 DSH。

### 3. 启动并配置

照常启动你的 `web` profile，然后打开 **设置 → 自动审批审查**：

```sh
dsh --profile web
```

首次使用时，先在 **设置 → 模型** 中配置 Provider 和 API Key。Auto Review 默认使用 Flash，也可以选择 DSH 中已经配置好的其他模型。插件不会读取其他应用保存的密钥。

## 常用设置

| 设置 | 什么时候调整 |
| --- | --- |
| 启用 Auto Review | 关闭后，回到 DSH 原生审批流程。 |
| 原生沙盒内默认通过 | 默认开启；关闭后，沙盒内操作也会送审，模型调用会增加。 |
| 审查 Full Access 动作 | 默认开启。Full Access 没有原生沙盒，除硬禁操作外全部送审；关闭后该档位使用 DSH 原生流程。 |
| 模型策略 | 日常用单模型即可；需要时再开启风险分级，配置高风险模型。 |

更换 Reviewer 前，先在 DSH 中配置对应 Provider 和凭据，再在插件设置中填写路由与模型 ID。审查会产生额外的模型费用。

## 安装时可能遇到的问题

- **端口被占用**：换一个空闲端口，浏览器地址和 SSH 转发端口一起调整；不必停止其他服务。
- **提示找不到执行组件或目录不安全**：检查第 2 步，以及 `DSH_AUTO_REVIEW_NATIVE_RUNTIME` 的路径和权限。
- **设置页存在，但工具旁没有图标**：部分 DSH 版本需要配套 UI 补丁；设置页可用不代表命令徽标已支持。[查看适配说明](docs/ISSUE-025-UI-OWNER-PATCHES.md)。
- **想装进已有 DSH**：请按[已有环境安装说明](docs/INSTALL-CANDIDATE.md#新增插件的热安装路径)操作，不要重复叠加插件入口。

当前发布的是预览版本。Auto Review 不能替代沙盒；Reviewer 出错时不会自动放行。

## 项目与许可

受 [Codex-style Auto Review](https://alignment.openai.com/auto-review/) 启发，由 [jhckevin](https://github.com/jhckevin) 维护。

项目自有代码采用 [MIT](LICENSE)。第三方代码、策略和图标的来源与许可见 [NOTICE](NOTICE) 和[第三方说明](THIRD_PARTY_NOTICES.md)。
