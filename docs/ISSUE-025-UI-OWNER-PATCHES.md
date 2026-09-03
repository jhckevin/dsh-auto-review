# ISSUE-025：原生 UI 所有者插槽兼容补丁

日期：2026-09-03。范围：alpha.5 客户端 API 迁移，以及 alpha.5 / rc.2 两条上游分支的图标所有者补丁；未修改线上服务。

## 上游确认与设计

固定源码：
- alpha.5：db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5。
- rc.2：b150a551b8d465e31e418e1b2eaf5e79bbb7d28e。

两者都没有 tool.call.badges 与 settings.section.icon。
tool.call.toolview 是 keyed 替换，不提供 next/parent 包装链；直接抢占其 key 会替换其他工具卡。
设置导航由 SettingsRoot 私有 navIcon 投影，settings.section 业务行不会接收 ReactNode 图标。
因此不能只靠插件注册虚构槽位宣称完成。交付两份最小、可独立应用的上游补丁：

1. patches/dsh-alpha5-tool-call-badges.patch：在真实 ToolCallTree 所有者注册 session/list 子槽，在根和嵌套调用右边渲染；完整保留 toolview 和 GenericToolCard fallback。
2. patches/dsh-alpha5-settings-section-icon.patch：设置壳声明 root/keyed 子槽，按 sectionId 选择图标；其他项目仍采用原生 navIcon fallback，不向业务 model 塞 ReactNode。

同一份补丁在上述两个固定 tag 上均完成 reverse → apply --check → apply。
文件名保留 alpha5 历史标识，不意味着只适用 alpha。
这只是 UI 扩展点，不改变命令执行、沙盒、审批权限或模型请求。

插件 alpha.5 侧使用 Cordis Context，裸 HostObservable 经框架 inject.hooks 生成 useReviewStatus，
不混装已不存在的 dsh-client-runtime alpha 包，不在组件内自行订阅外部服务。
rc.2 插件必须保留自己的旧框架 API，不移入 alpha 的 Context/observable 实现。
两个图标均使用已存在的同一 SVG；拒绝徽章仍带红色斜杠。
未应用所有者补丁时，官方界面保留原生显示，插件设置页明确提示缺失条件，不能称图标已上线。

## 生命周期修复

ReviewStatusClient 旧 unsubscribe 反复执行会删除同 session 的新状态，造成新轮询器不再被 dispose 跟踪。
现在 unsubscribe 幂等；stop 仅删除同一 state 身份；dispose 幂等，旧 source / subscribe 此后不启动轮询，新 source 请求抛出 disposed。
新增重订、旧 cleanup、dispose 后订阅及定时器归零回归。

## 本轮实际证据

- 插件徽章 SVG / bare observable / 生命周期：10/10。
- alpha.5 实际 patched ToolCallTree SSR：2/2；实际 SettingsRoot jsdom 打开、导航 SVG、fallback、Escape 关闭：1/1。
- rc.2 实际 patched 同名源码，使用隔离展示层 fixture：同 3/3。
- 全量 tests TypeScript noEmit 通过。
- 两份补丁分别通过上述两个 tag 的 git apply --check。

测试在服务器独立 upstream worktree 执行，未改原始 clone。React 工具卡 fallback、renderSlot 绑定和部分壳图标通过 fixture 隔离；主图标组件、ToolCallTree 和 SettingsRoot 来自真实源码。
这不是完整 Loader / SlotRenderer 组合验收、真实浏览器截图、线上部署或新版 upstream 全量构建的证明。
rc.2 展示层 proof 使用 alpha 插件测试依赖解析纯组件，不能把它扩展成 rc.2 后端依赖兼容性结论。
没有新增 API 调用。CI 增强 job 未启用；以下是可重复服务器 / CI 命令，不代表已经在远端 CI 运行。

## 重现方式

在已完成 npm ci 的 alpha 插件 checkout 中执行，Node 24.20+。lock 包含 jsdom、clsx、
alpha.5 dsh-client-ui-primitives / ui-renderer / client-store。克隆地址使用已批准镜像。

```sh
plugin_root=$(pwd -P)
proof_root=$(mktemp -d)
git clone --no-checkout "$DSH_APPROVED_MIRROR" "$proof_root"
git -C "$proof_root" checkout --detach db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5
git -C "$proof_root" apply --check "$plugin_root/patches/dsh-alpha5-tool-call-badges.patch" "$plugin_root/patches/dsh-alpha5-settings-section-icon.patch"
git -C "$proof_root" apply "$plugin_root/patches/dsh-alpha5-tool-call-badges.patch" "$plugin_root/patches/dsh-alpha5-settings-section-icon.patch"
ln -s "$plugin_root/node_modules" "$proof_root/node_modules"
DSH_BADGE_PROOF_ROOT="$proof_root" node node_modules/vitest/vitest.mjs run --config vitest.badge.config.ts
```

rc.2 另用全新目录，并将 checkout SHA 换为 b150a551b8d465e31e418e1b2eaf5e79bbb7d28e。
不要复用已打补丁的目录叠加执行。proof 的 node_modules 链接用于真实源文件模块解析；
vitest.badge.config.ts 显式允许插件和 proof 两目录，避免 jsdom/Vite 跨根拒绝。
未提供 DSH_BADGE_PROOF_ROOT 时专用配置直接报错，普通测试中的 source-plane 用例显式 skip，不能算成已执行。

## 补丁 SHA-256

- tool-call-badges：76b69cb19c06b7500dd388a21256c9a39af9dea7887344dd58768793dfe65b5a
- settings-section-icon：90fc185cd6d071c10a32db48c0b96c0897928eb5e842ff21dfc11eed49aeebf7
