# 原生桥接源码与证据门禁

对应 [Issue #5](https://github.com/jhckevin/dsh-auto-review/issues/5)。这里公开受控开发执行器、证据验证器与许可证材料测试，不再仅引用私有工作目录。

固定桥接源码提交：`c2016f6d89382661d760da4499e6a44079fbfe88`；上游 `9f97cb79eb15b38d24c552c56fe24e211ff9cf3a`。

- `src/` 可直接浏览源码；CI 将其逐字节与冻结归档比较，防止展示代码和运行代码不同。
- `vendor/native-audit/native-audit-source.tar.gz` 保留全部测试输入及原始许可证/来源材料，SHA256 为 `da9609f455a4a69f28de10116d23563cdbb425fd2e9758726a0853e7b2cc1bc8`。
- Actions 的 `Native source evidence` 独立执行 19 项 Node + 12 项许可 + 5 项归档测试，失败仍上传日志；无需模型密钥、npm 安装或 Rust 编译。
- 材料涵盖 672 个组件、1,350 条归档引用、0 项材料缺口；10 个组件没有上游独立许可证文件，发布声明/标准正文单列，`legalApproval=false`，不是法律认证。

**源码/负面门禁测试通过不等于 native 正式发行通过。** 部分测试专门验证缺失或伪造完整执行证据会被拒绝。完整 Rust1.95 的 test/fix/fmt/Bazel 工作流、对应二进制重建及可重复性仍独立验收；未完成前旧 `0.1.0-rc.1` 二进制不会被重新标记为通过。

本目录的受控 runner 是开发工作流执行器，不是新实现的完整 Guardian 或 DSH 工具执行系统。自有测试/执行器代码遵循仓库许可证；归档中的上游源码与许可证按各自原始声明保留，不将第三方材料改为本项目 MIT。
