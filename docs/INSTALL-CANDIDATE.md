# 安装与版本匹配（未发布候选）

本页描述固定环境的工程候选安装，不是生产适用性承诺。默认 codex-native 使用独立命名的 bridge 候选包，并通过 staged tgz 离线安装；GitHub 工程预发布范围见 [GITHUB-PREVIEW.md](GITHUB-PREVIEW.md)。npm 尚未发布，不提供不存在的注册表一键命令，也不静默切换 legacy-js。新增热安装范围及一次性受保护 runtime 部署见 [ISSUE-027-HOTPLUG.md](ISSUE-027-HOTPLUG.md)。

## 固定版本

本轮热生命周期候选：DSH 0.1.1-rc.2 对应插件 0.5.6-rc.2。DSH 0.1.2-alpha.5 对应旧插件 0.5.7-alpha.1，尚未同步本轮热安装。使用完整 Git commit 和 tgz SHA256 区分，不移动既有 tag，不覆盖已发布同版本包。

- Linux x86_64；Node >=24.11.0，本轮使用 24.20.0。
- 锁定整套 DSH 依赖，不只锁定 CLI；alpha 不能混入 rc 的 Session/Client API。
- native 依赖：@jhckevin/dsh-auto-review-bridge-host@0.1.0-rc.1 及精确版本 Linux 平台包。源码 lock 中的镜像 URL 是未来发布位置；SHA512 来自已核验候选 tgz，不代表 URL 已可下载。发布前通过 DSH_BRIDGE_ARTIFACTS 提供匹配 tarball 验收。
- 原生沙盒的状态必须实测；partial 不得标为 full。容器本身也不等于 DSH 每次动作拥有完整沙盒。

## 冷启动参考部署（不是热安装命令）

1. 在独立远程目录安装固定版本 DSH 与本地打包的候选 tgz，保留 lock 和 SHA256；不用全局安装，不复用生产 HOME。
2. 若需要命令右侧 badge 和设置页图标，对同版本 DSH 源码先执行 git apply --check，再应用 patches 中的两个所有者补丁。用上游 clientBundle 构建 ui-tool、ui-settings-general 的客户端模块；只替换对应客户端，不覆盖原生工具卡片和 host 模块。官方未打补丁版只能显示原生界面，不能声称两个插槽已支持。
3. 使用独立 DSH_HOME、workspace 和只监听 loopback 的入口。原生 CLI 已实际验证的启动形态：

```sh
node node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile web \
  --patch node_modules/@jhckevin/dsh-auto-review/cordis.patch.yml \
  --host 127.0.0.1 --port 9835 --no-open
```

4. 模型路由和凭据通过原生 Harness 服务端配置。插件只保存 provider/model 选择，不把密钥带入浏览器。默认单模型 Flash；用户主动选择风险分级后才可能调用 Pro，需单独考虑费用和 provider 支持。
5. 浏览器验证设置读取、保存、刷新、冲突保护和实际模型请求参数。截图成功不能替代运行态审计；API 测试也不能替代浏览器操作。
6. 停止测试实例，保留脱敏日志和制品；升级生产前备份配置并使用新版本制品。回滚同时匹配 DSH、插件和两个 UI 所有者模块，不跨版本只换 JS。

本轮 pnpm 11.7.0 的隔离 UI 安装已成功；npm peer 求解曾耗时并接近 2 GiB，已主动停止并留日志，不能把安装器异常隐去。完整复现仍需要未公开桥接产物，因此本页只记录已验证的内部候选流程。

## 新增插件的热安装路径

首次由管理员部署受保护 native runtime，并为同一 rc.2 DSH 宿主安装配套 live-discovery/client graph 补丁后，才进入此路径。补丁安装本身需要一次构建和重启；不能让尚未安装的扩展替自己修改宿主。

之后以普通 DSH 运行用户，使用其原生 profile 插件管理入口安装已核验的完整离线制品集合。**未发布候选还需要准备依赖覆盖**，不能只传主包就期望离线解析成功。本轮 pnpm 11.7.0 在目标 profile 的 `pnpm-workspace.yaml` 中使用以下映射；`package.json` 里的旧 `pnpm.overrides` 在该版本并不生效。先确认宿主拥有同一套 rc.2 peers，再关闭自动补装 peers：

```yaml
autoInstallPeers: false
overrides:
  '@jhckevin/dsh-auto-review': file:/approved-artifacts/jhckevin-dsh-auto-review-0.5.6-rc.2.tgz
  '@jhckevin/dsh-auto-review-bridge-host': file:/approved-artifacts/jhckevin-dsh-auto-review-bridge-host-0.1.0-rc.1.tgz
  '@jhckevin/dsh-auto-review-bridge-linux-x64-gnu': file:/approved-artifacts/jhckevin-dsh-auto-review-bridge-linux-x64-gnu-0.1.0-rc.1.tgz
  '@deepseek-ai/schemastery': file:/approved-artifacts/deepseek-ai-schemastery-3.18.2.tgz
  '@deepseek-ai/cosmokit': file:/approved-artifacts/deepseek-ai-cosmokit-1.8.3.tgz
  '@standard-schema/spec': file:/approved-artifacts/standard-schema-spec-1.1.0.tgz
  node-addon-api: file:/approved-artifacts/node-addon-api-8.9.2.tgz
  node-gyp-build: file:/approved-artifacts/node-gyp-build-4.8.4.tgz
  tree-sitter: file:/approved-artifacts/tree-sitter-0.25.1.tgz
  tree-sitter-bash: file:/approved-artifacts/tree-sitter-bash-0.25.1.tgz
```

此映射用于已验证的候选集合，不覆盖用户既有 profile 文件；生产部署应合并并审查冲突。补齐后执行：

```sh
dsh plugin --profile web add /approved-artifacts/*.tgz --offline --ignore-scripts
```

`/approved-artifacts` 必须是仅含此次插件、匹配 host/platform 和所需运行时依赖的专用目录；不是从任意下载目录安装。离线集合、peer 身份和镜像缓存必须事先验证。此次实际测试使用隔离的 rc.2 依赖图，不保证任意现有 profile 的依赖冲突都能自动解决。

采用 `plugin add` 的 bundle 自动发现后，**不要再叠加上面的手工 `--patch`**，以免重复组合相同角色。一般设置修改走设置 RPC；关闭/启用 reviewer 走 Cordis 生命周期；已导入 host 代码的升级或删除仍需重启。浏览器热到达结果单独记录在 ISSUE-027，不能把 CLI 安装成功视为整条体验已通过。

## 公开发布清单

公开源码与工程预发布不等于完整稳定版本验收。SVG 权利状态、第三方材料原始缺项、完整原生执行系统、沙盒与安全替代覆盖仍须分别报告；本次不把这些门禁改成已通过。npm 发布及稳定生产认证是后续范围。

GitHub Topics 计划：deepseek-harness、dsh-plugin、cordis、auto-review、codex-style、sandbox、agent-security。package keywords 已设置，实际远程 Topics 在发布时验证。
