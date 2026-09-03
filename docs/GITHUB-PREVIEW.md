# alpha5 工程候选 0.5.7-alpha.3

精确宿主 DSH 0.1.2-alpha.5；native host/platform 0.1.0-rc.2。本通道不混装其他 DSH prerelease。GitHub Release 提供制品，未发布 npm；不存在公开附件的版本不要强行安装。

## 安装

要求 Linux x86_64/glibc、Node24.20.0、npm、tar、sha256sum。下载对应 Release 的 offline-candidate.tar.gz、SHA256SUMS、prepare-preview-install.mjs、public-dsh-family.json，并在全新下载目录校验全部下载文件的匹配 SHA256SUMS 条目。解压离线包得到十一个 tgz 后，仍需对十一个包逐项核验 SHA256SUMS。

```sh
node /absolute/download/prepare-preview-install.mjs /absolute/download /absolute/new-preview
cd /absolute/new-preview
npm install --ignore-scripts --legacy-peer-deps --registry=https://registry.npmmirror.com
HOME="$PWD/home" DSH_HOME="$PWD/home" node node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --patch "$PWD/node_modules/@jhckevin/dsh-auto-review/cordis.patch.yml" --host 127.0.0.1 --port 9821
```

准备器只创建新目录并校验制品，绝不改现有 profile，不自行 sudo。安装下载的是公开 npm 包，不是完整离线 DSH 宿主。rc6 历史 node-pty 若缺 Node24 Linux预构建，需要单独审查并本地构建；脚本不自动运行安装生命周期。alpha5 web 使用宿主原生 token/cookie 登录链，不关闭认证。

管理员必须预置受保护 native runtime；用户可写 node_modules 不能当可信二进制根。未配置 runtime 时不得视为 native approval 通过，插件失败关闭，不悄悄改 legacy-js。

## 实际边界

源码构建、全量类型、行为测试、policy provenance、packed consumer 与公开冷启动后端已记录。此通道未验收浏览器热安装、真实模型、受保护 native 审批；完整 Guardian/生产安全认证未完成。rc2 的宿主热安装补丁不能应用到本通道；使用独立 profile 冷启动。旧文档中的生产门禁描述是目标，不是已通过结论。

CI/Release 会保留每阶段日志、JUnit、十一个 tgz、离线归档、两份文档、准备器、family清单、receipt、SHA256SUMS，共18附件。任何构建或测试失败会阻止发行；历史 alpha 文档/UI夹具 SKIP 保留公开，不伪称执行。

源证据见 [公开冷启动记录](https://github.com/jhckevin/dsh-auto-review/blob/v0.5.7-alpha.3/docs/PUBLIC-COLD-VALIDATION.md) 和 [兼容迁移说明](https://github.com/jhckevin/dsh-auto-review/blob/v0.5.7-alpha.3/docs/ISSUE-032-COMPAT.md)。发行 immutable tag，不覆盖旧制品。native仍冻结0.1.0-rc.2，许可证和完整上游开发/重建验收须单独审查，不能由源码打包证明完成。

Alpha5 includes the exact dsh-util-values0.1.2-alpha.5 archive as its eighth runtime dependency. It remains a production dependency because published type declarations reference JsonValue; the upstream utility has no shared service identity. Packed installation uses its own empty npm cache and remains offline.
## 本次 native rc.2 升级证据范围

本次候选更新 native host/platform 至0.1.0-rc.2，两个包字节固定不重写；旧rc.1及旧插件tag保留在Git与历史发行。本文链接的公开冷启动记录来自前一候选，不能自动推断新二进制已完成同样的真实宿主/模型验收。本次执行新包npm ci、构建、全量类型、行为测试、策略来源、packed consumer独立空cache，以及原source lock经明确ONLINE预取后新consumer OFFLINE重放。最终发行还须等待独立protected E2E及native证据验收；本DSH通道不声称热安装或完整Guardian通过。

完整安装说明：[INSTALL-CANDIDATE](https://github.com/jhckevin/dsh-auto-review/blob/v0.5.7-alpha.3/docs/INSTALL-CANDIDATE.md)。本通道不适用 rc2 热安装补丁，不能由其他通道热测试推断通过。

本次额外源码附件以 `SOURCE-README.md` 和 `SOURCE-SHA256SUMS` 为入口，连同 `bridge-source.tar.gz`、`upstream-source.tar.gz` 共四份补充。它们是源码/材料证据，不增加运行 tgz 数量；历史 allocative 材料不能代替本次 native/source gate，也不单独代表法律认证。
