# 安装与版本匹配（未发布候选）

本页不是可公开安装的发布承诺。当前默认 codex-native 所依赖的桥接包仍为私有原型；在其源码、许可证和 Linux x86_64 产物公开并通过洁净安装前，不提供虚构的 npm 一键安装命令，也不静默切换 legacy-js。

## 固定版本

截至 2026-09-03 本轮核验：DSH 0.1.1-rc.2 对应插件 0.5.6-rc.1；DSH 0.1.2-alpha.5 对应插件 0.5.7-alpha.1。候选版本的后续提交用完整 Git commit 和 tgz SHA256 区分，不移动既有 tag；最终公开制品必须升新版本，不能覆盖同版本包。

- Linux x86_64；Node >=24.11.0，本轮使用 24.20.0。
- 锁定整套 DSH 依赖，不只锁定 CLI；alpha 不能混入 rc 的 Session/Client API。
- native 依赖：@dsh/codex-approval-bridge-host@0.0.0-prototype.5 及其平台产物。optional peer 并不等于已安装；本轮只验证受控内部产物。
- 原生沙盒的状态必须实测；partial 不得标为 full。容器本身也不等于 DSH 每次动作拥有完整沙盒。

## 本轮实际验证的部署顺序

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

## 公开发布清单

完成 SVG 权利清理、第三方许可证、native 桥接公开安装、完整沙盒验收、拒绝后安全替代真实分支覆盖后，才创建公共仓库 Release / npm 包与版本标签。

建议 GitHub Topics：deepseek-harness、dsh-plugin、cordis、auto-review、codex-style、sandbox、agent-security。package keywords 已设置；Topics 未声称已在远程仓库生效。
