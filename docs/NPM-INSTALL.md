# npm 发布与一条命令安装

目标安装方式遵循 DeepSeek Harness 官方 Bundle 流程：

```sh
dsh plugin --profile web add @jhckevin/dsh-auto-review@rc6
```

## 包关系

npm 按下面的依赖关系自动安装完整运行内容：

```text
@jhckevin/dsh-auto-review
└── @jhckevin/dsh-auto-review-bridge-host
    └── @jhckevin/dsh-auto-review-bridge-linux-x64-gnu
```

平台包通过 `os: linux`、`cpu: x64` 和 `libc: glibc` 限定 Linux x86_64 glibc。主包保留 `dsh.bundle.patch`，因此 `dsh plugin add` 会自动把 Bundle 加入 profile；用户不再手写 profile 或叠加 `--patch`。

dist-tag 与 DSH 通道一一对应：DSH 0.1.0-rc.6 使用 `@rc6`，0.1.1-rc.2 使用 `@rc2`，0.1.2-alpha.5 使用 `@alpha5`。不发布含糊的 `latest`。

## 发布顺序

`.github/workflows/npm-publish.yml` 只允许手动触发，并要求输入 `publish`。它会：

1. 校验冻结的原生制品；
2. 构建并运行类型与行为测试；
3. 准备发布元数据，并让 host 精确锁定最终平台包清单；
4. 在发布前用最终 tarball 启动一次 root 保护的原生桥；
5. 按平台包、host 包、主包的顺序发布；重跑时只跳过内容散列和 dist-tag 都完全一致的既有版本；
6. 固定 pnpm 版本后，从 npm 公网运行官方 DSH 安装命令；
7. 把平台包复制到 root 管理、运行用户不可写的目录，再次启动原生桥，完成一次请求并关闭进程。

发布只允许从与插件版本完全匹配的 Git tag 触发，环境名为 `npm`。GitHub Environment 应仅允许受保护的发布 tag，并配置人工审核。

npm Trusted Publisher 不能创建从未发布过的新包。首次发布三包时，需要维护者在受保护的 `npm` Environment 中临时配置一个满足 npm 2FA 要求的细粒度 `NPM_TOKEN`，完成首次发布后再为每个包绑定本工作流并删除该 secret。不要把 token 写入仓库、命令参数或日志。

## 发布前检查

`scripts/verify-npm-one-command.mjs` 使用全新 npm 缓存，只向 npm 传入一个主包；普通依赖从镜像解析，host 与平台包通过与公开 registry 相同的递归依赖关系安装。测试会确认三个包同时存在。

这项检查会核对 host 与平台包的 provenance 锁定完全一致。发布后的干净 Linux 验收还会部署受保护运行目录并真正启动原生桥，能发现平台包缺失、glibc 不兼容或执行权限问题。它不冒充 npm 公网发布；公网安装只在发布工作流完成后才算通过。
