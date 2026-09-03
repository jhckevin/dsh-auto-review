# 原生桥接源码与证据门禁

对应 [Issue #5](https://github.com/jhckevin/dsh-auto-review/issues/5)。这里公开受控开发执行器、证据验证器与许可证材料测试，不再仅引用私有工作目录。

固定桥接源码提交：`5bf5654b3e29e180b5258121c74243246cdfe93f`；上游 `9f97cb79eb15b38d24c552c56fe24e211ff9cf3a`。

- `src/` 可直接浏览源码；CI 将其逐字节与冻结归档比较，防止展示代码和运行代码不同。
- `vendor/native-audit/native-audit-source.tar.gz` 与该提交生成的完整 `bridge-source.tar.gz` 字节相同，归档根为 `bridge/`，1,703,633 bytes，SHA256 为 `08a2c93ea95f80bf7ed36f45bff8e2c9dd4067b912d9d561156a2292d1bdae42`。包含 rc2 pins、受控执行器与 f 执行证据、原始许可证/来源材料及测试辅助源码；不包含构建缓存、HOME 或原生二进制。
- 源码门禁测试覆盖开发证据、镜像输入、实际 Rust 工具绑定、材料/launcher 来源与归档。应从完整解压根执行；`src/` 是审阅镜像，不包含整个 fixture。launcher 测试需从已核对 SHA 的实际平台包提供 `packages/platform/bin/landlock-run`，不能把缺少二进制的源码档当完整安装包。
- 材料涵盖 672 个组件、1,350 条归档引用、0 项材料缺口；10 个组件没有上游独立许可证文件，发布声明/标准正文单列，`legalApproval=false`，不是法律认证。

**源码/负面门禁测试通过不等于完整产品生产验收通过。** 部分测试专门验证缺失或伪造完整执行证据会被拒绝。归档中的 f 记录是固定 Rust1.95 的 11 步 test/fix/fmt/Bazel 工作流真实执行；其结果必须通过 `inspectDevelopmentEvidence` 对源码、工具、环境及日志绑定验证。旧 `0.1.0-rc.1` 缺少该包内证据，会被开发门禁拒绝；不会重新标记旧制品通过。

`verify-native-package.mjs ABS_PLATFORM ABS_HOST ABS_MATCHING_AUDIT_ROOT` 使用实际解压安装包，核对 host pins、二进制/launcher 大小及 SHA、全部执行辅助源与镜像一致、Rust 材料、11 步开发证据及独立 launcher 原始 npm 来源。随后在 Linux x86_64 通过已校验的同一文件描述符执行 launcher/bridge，限时 10 秒、合计输出上限 64 KiB，验证握手 hardening 字段与 i64 两端及溢出拒绝。无需模型/API、root 或网络。

该入口对实际 rc2 包已执行通过：binary SHA256 `dd6ad6bf0ebec9ae36d40fdaa91dda8aabb21bc3191366a5b0e25b8f5e10888b`。结论限定为 `NATIVE-PACKAGE-SCOPED-ACCEPTANCE-PASS`；4 帧 smoke 不是完整 owner、DSH 工具沙盒或应用验收。launcher 来源单独覆盖 2 个官方 npm 包、15 个成员，不计入 672 个 Rust 组件，也不声称 launcher 源码重编可复现；`productionAcceptance=false`、`legalApproval=false` 保持明确。

本目录的受控 runner 是开发工作流执行器，不是新实现的完整 Guardian 或 DSH 工具执行系统。自有测试/执行器代码遵循仓库许可证；归档中的上游源码与许可证按各自原始声明保留，不将第三方材料改为本项目 MIT。
