# 候选版安装与工具图标

0.6.0 尚未发布到 npm。不要把以下本地包安装命令误写成已发布版本。
取得本分支 CI 的候选 tgz 后，按 DSH 官方插件方式安装：

```sh
dsh plugin --profile web add ./jhckevin-dsh-auto-review-0.6.0.tgz
```

模型凭据仍在 DSH 的模型设置中配置。插件默认使用已配置的 Flash 路由，
不会从聊天记录搜集 API Key。原生受控执行组件的初始化仍按 README 第 2 步执行。

## 设置导航与逐工具盾牌

官方宿主缺少两个显示插槽，单独安装插件不能凭空增加宿主插槽。
候选包附带经过修改的 DSH UI owner，使用原生槽位注册机制，
不是页面 DOM 注入，也不会替换工具执行、权限或沙盒代码。

随包包含 **DSH 0.1.0-rc.6、0.1.1-rc.2、0.1.2-alpha.5** 的匹配 UI 包。停止 DSH 后执行：

```sh
# 用实际 profile 和宿主的 node_modules 目录替换下面两个路径。
node /path/to/profile/node_modules/@jhckevin/dsh-auto-review/scripts/install-ui.mjs \
  --dsh-root /path/to/dsh/node_modules --check
node /path/to/profile/node_modules/@jhckevin/dsh-auto-review/scripts/install-ui.mjs \
  --dsh-root /path/to/dsh/node_modules
```

重新启动 DSH 并刷新浏览器。普通沙盒动作不加审查盾牌；进入 reviewer 时显示小盾牌，
批准后移除；拒绝后显示红色盾牌与斜杠。设置选项卡使用同一 SVG。
用 npm 安装包的环境也会生成 `dsh-auto-review-ui` 可执行入口；
自动发现失败时请显式提供 `--dsh-root`，不要修改其他 DSH 安装。

需要还原时，先停 DSH，再运行同一命令加 `--restore`。
安装器检查版本、原文件和制品 SHA-256，保留原始备份；全部预检通过才开始写入。
重复安装不重复修改，出现写入失败会回滚已修改的文件。被其他插件改过的文件不会被覆盖。
宿主更新后应重新检查版本，不能继续套用旧补丁。只读容器请在镜像构建阶段安装。

三版本官方安装矩阵包括包内 UI 安装、重复安装和还原。未知版本仍拒绝安装。
宿主 UI owner 更新需要重启，不属于完全热安装。真实浏览器验收范围另见发布验证记录。

## 终端提示

WebUI 的硬中断提示来自真实的 `turn/end` 事件，刷新后仍可重现。
终端 profile 可以额外挂载 `@jhckevin/dsh-auto-review/terminal`，
把同一事件显示为标准错误输出提示。它不是完整 TUI 页面，也不会在 Web profile 自动挂载。

## 来源与复建

宿主源码 commit、两份原始文件和替换文件的 SHA-256 在 `ui/manifest.json`。
两份 source diff：

- `patches/dsh-alpha5-tool-call-badges.patch`
- `patches/dsh-alpha5-settings-section-icon.patch`

在对应 DSH 源码提交应用这两个补丁，安装该提交匹配的依赖，
使用宿主 `packages/client/tsdown.client.ts` 的 `clientBundle` preset
构建 `ui-tool` 与 `ui-settings-general` 的 client entry。
不能用其他版本的 workspace 别名替代对应版本的 wire 依赖。
rc6 使用 patches/dsh-rc6-ui-owners.patch；rc2 / alpha5 使用上面的两个补丁。
使用 node scripts/build-ui-owners.mjs SOURCE HOST_NODE_MODULES OUTPUT LIGHTNINGCSS_ENTRY 重建匹配的 UI 包。
构建器校验源码与宿主包版本，不允许未解析的依赖悄悄成为浏览器外部模块。
