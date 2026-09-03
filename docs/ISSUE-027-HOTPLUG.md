# ISSUE-027：可分发 native bridge 与热生命周期

状态：未发布候选，非生产上线承诺。对应插件 0.5.6-rc.2、DSH 0.1.1-rc.2。此改动尚不代表 alpha 分支已同步。

## 三个不同层次

1. **安装制品**：插件直接依赖精确版本 `@jhckevin/dsh-auto-review-bridge-host@0.1.0-rc.1`，不再依赖私有 prototype 的 optional peer。host 精确引用 Linux 平台包；无运行时下载、编译、提权或静默 JS 降级。
2. **生命周期**：每次 provider activation 有独立 native owner。卸载先取消请求，再关闭 session/子进程；新 activation 可重新创建 owner。旧请求不能在新 generation 获准，也不污染其 transport 熔断计数。相同部署默认值重载保留用户已保存配置；改变默认值须重载 settings bridge，不隐式覆盖用户设置。
3. **DSH 包发现**：原版已运行的 Web host 不会仅因 `dsh plugin add` 就重新扫描启动时组合的 bundles。配套 DSH 补丁增加 web profile 的 live reconciliation；这不是插件可以自行绕过的宿主限制。

## 信任边界

普通用户可写的 profile 不可兼任受保护二进制根目录。`DSH_AUTO_REVIEW_NATIVE_RUNTIME` 指向管理员首次部署的平台包根目录，必须为绝对、canonical、无 symlink、运行用户不可写且祖先 root-owned 的目录。bridge 仍检查包元数据、固定 provenance、大小、SHA256 和执行文件描述符，不接受用户可写的替代二进制。设置了无效路径就拒绝，不回退别处。

管理员操作只属于首次 runtime 安装/版本升级，不能让模型或插件自己执行 sudo。DSH host/plugin 的 JS 属于宿主受信扩展代码；这个机制不声称抵御已经被攻陷的宿主或管理员。没有管理员部署条件时，应使用预置受保护层的隔离容器，不能关闭校验伪装成完整安装。

管理员核验上述制品 SHA256 后，在 root 管理终端首次部署（这里只是说明，插件绝不执行提权）：

```sh
install -d -o root -g root -m 0755 /opt/dsh-auto-review-native/0.1.0-rc.1
npm install --prefix /opt/dsh-auto-review-native/0.1.0-rc.1 --offline --ignore-scripts --no-audit --no-fund /approved-artifacts/jhckevin-dsh-auto-review-bridge-linux-x64-gnu-0.1.0-rc.1.tgz
```

之后以普通用户启动 DSH，在其启动环境设置：

```sh
export DSH_AUTO_REVIEW_NATIVE_RUNTIME=/opt/dsh-auto-review-native/0.1.0-rc.1/node_modules/@jhckevin/dsh-auto-review-bridge-linux-x64-gnu
```

DSH profile 使用原生 `dsh plugin --profile web add` 入口安装候选制品（未发布前必须同时提供 host/platform 的本地 tgz，不能让包管理器请求不存在的 registry 版本）。公开发布后才改成版本化包名。配套宿主补丁在 `patches/dsh-rc2-web-live-bundle-discovery.patch`，针对固定 DSH rc.2 基线；首次应用宿主补丁本身需要构建和重启，之后才有新增 bundle 的 live discovery。不能声称一个尚未加载的插件能自行更新宿主的包发现器。

## 热操作的承诺范围

| 操作 | 行为/限制 |
|---|---|
| 已加载 reviewer provider 关闭、再开启 | 取消旧请求、释放 owner，重新启用创建新 owner |
| 修改普通插件配置 | 使用 Cordis 生命周期；用户持久配置不被同值默认配置覆盖 |
| 安装一个尚未加载的新 bundle | 需要配套 DSH web live-discovery 补丁；原版仅重启后发现 |
| 删除/替换已经导入的 host 包 | 提示需要重启，保留旧保护；不宣称支持 Node host 代码热替换 |
| 同路径同 manifest 原地改代码 | 不支持；发布应升版本，不做生产目录原地写入 |
| alpha DSH | 尚未完成本轮热安装适配，不混用 rc peer 版本 |

插件停用和安全策略移除不是一回事。停止 reviewer 时不能把审查不可用自动变成批准。完整移除安全插件属于管理员明确改变策略，并不是每条拒绝动作的绕过手段。

## 已有证据与边界

- 源码构建、测试类型检查与 214 项测试通过，包括真实 Cordis provider fiber 的卸载/重新启用、旧 generation resolve/reject 隔离、保存设置保留。
- 独立复审 service 的 19 项 focused 测试通过。
- 第一轮真实原生子进程测试：16 对独立 scopes、33 个子进程、8 个在途请求取消、0 迟到批准、exit listener 回到基线；容器退出 0、OOM=false、无网络和端口。这一轮使用旧包布局叠加新 factory，不能代替最终新名称 tgz 安装测试。
- 第二轮已对最终公开命名 tgz 安装镜像重复同一原生生命周期测试：33 子进程/8 取消/0 迟到批准均通过，退出 0、OOM=false、ports={}。桥接镜像 `daf3cf41d5efc316c60942aea34dfb86a3309d268d88f258c30473c69d68c9b1`，适配器测试镜像 `feae074d9cf6c2f3d9f04ef7691c23763719fd3fa57bf3842f3e3bb84831e50b`。可复用 `scripts/e2e-native-lifecycle.mjs`，在构建后的插件目录、受保护平台且非 root 的环境运行。
- 桥接独立审查对同一制品镜像重跑 25 项 owner + 12 项安装/篡改/保护目录测试全部通过；DSH `7026a9fd` 的 3 项文件 watcher smoke 也经独立复跑通过。
- DSH live-discovery 的源码测试不能代替实际 `dsh plugin add` + 浏览器端到端测试。
- 本轮未调用付费模型 API；不以生命周期 fixture 声称真实 Flash 风险判断验收。
- npm/GitHub 尚未发布。公开 registry 可解析、最新 DSH 兼容、完整浏览器安装体验仍须分别验收，不能仅凭 `private:false` 声称公众已能安装。

最终打包测试支持 `DSH_BRIDGE_ARTIFACTS`（JSON 数组，列出精确 staged host/platform tgz 路径）执行离线安装。它验证本地制品，不伪造 registry 发布结果。公开后应以实际 registry 制品和独立用户环境再次执行洁净安装。

候选制品固定记录（0.1.0-rc.1）：

- host tgz SHA256：`1fa0edd6d68811818622cdaff4bb240c743ad8484548d710c9b8629ca4415d27`
- linux-x64-gnu tgz SHA256：`7e879d7384d2ede31ddeca0928d85e7f6203734232b49ea0aa8a32324424a24d`
- bridge 源码：`a25421efb28d290e40d84572039be75b94ff2099`；其源码归档记录在后续证据提交 `ac7214b681ca08c999cfe21c870af6a323ff2fd8`。
- 平台许可声明材料已随包保存；不将声明覆盖率冒充原始上游 LICENSE 文件齐全或法律认证。
