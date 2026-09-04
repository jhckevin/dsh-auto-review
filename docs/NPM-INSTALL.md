# npm 发布与一条命令安装

目标安装方式遵循 DeepSeek Harness 官方 Bundle 流程：

```sh
dsh plugin --profile web add @jhckevin/dsh-auto-review@rc2
```

## 包关系

npm 按下面的依赖关系自动安装完整运行内容：

```text
@jhckevin/dsh-auto-review
└── @jhckevin/dsh-auto-review-bridge-host
    └── @jhckevin/dsh-auto-review-bridge-linux-x64-gnu
```

平台包通过 `os: linux` 和 `cpu: x64` 限定 Linux x86_64。主包保留 `dsh.bundle.patch`，因此 `dsh plugin add` 会自动把 Bundle 加入 profile；用户不再手写 profile 或叠加 `--patch`。

dist-tag 与 DSH 通道一一对应：DSH 0.1.0-rc.6 使用 `@rc6`，0.1.1-rc.2 使用 `@rc2`，0.1.2-alpha.5 使用 `@alpha5`。不发布含糊的 `latest`。

## 发布顺序

`.github/workflows/npm-publish.yml` 只允许手动触发，并要求输入 `publish`。它会：

1. 校验冻结的原生制品；
2. 构建并运行类型与行为测试；
3. 给两个桥接包补齐公开仓库、问题地址和 provenance 元数据；
4. 按平台包、host 包、主包的顺序发布；
5. 从 npm 公网运行官方 DSH 安装命令，检查 profile 和组合配置。

发布环境名为 `npm`，需要在 npmjs.com 配置对应 GitHub Actions Trusted Publisher。三个包首次创建前，npm 可能要求维护者先完成账号或 scope 所有权验证。

## 发布前检查

`scripts/verify-npm-one-command.mjs` 使用全新 npm 缓存，只向 npm 传入一个主包；普通依赖从镜像解析，host 与平台包通过与公开 registry 相同的递归依赖关系安装。测试会确认三个包同时存在。

这项检查证明包依赖关系，不冒充 npm 公网发布。公网安装只在发布工作流完成后才算通过。
