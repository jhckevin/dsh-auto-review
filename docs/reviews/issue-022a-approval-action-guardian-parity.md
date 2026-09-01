# ISSUE-022A：ApprovalAction、缓存与 Guardian action format 审查证据

## 审查范围

- 固定上游：`openai/codex@9f97cb79eb15b38d24c552c56fe24e211ff9cf3a`
- manifest 模块：`approval-action-and-cache`、`guardian-action-format`
- 最终候选：`4b9da8abaea756b98543df68811699e90929304d`
- 审批范围仅限 ISSUE-022A；不代表其他 parity 模块或整体 release 已完成。
- 审查代理以任务的 canonical agent name 记录。审查消息没有提供独立 UUID，本文不伪造 UUID。

## 提交与审查历史

| 轮次 | 被审提交 | 审查代理 | 结论 | P0/P1/P2 | 关键发现或验证 |
| --- | --- | --- | --- | --- | --- |
| 初始实现 | `4bdeee8a174b6993dd4b6afc197777c555725d6b` | `/root/review_issue022a_commit` | FAIL | 0/4/1 | PathUri/AbsolutePath 与 ApplyPatch 边界不完整；truncation、命令规范化、强类型协议和真实上游 oracle/packed runtime 证据不足。 |
| 第一次整改 | `4245331f9e530bf3c7f67aa79ec52ad1ed9731ab` | `/root/review_issue022a_remediation` | FAIL | 0/3/1 | PathUri 完整值语义、PermissionProfile 自定义 serde/NonZeroUsize、Guardian oracle 仍未真实调用上游；输入 blob/完整 SHA 证据不足。 |
| 第二次整改 | `a54493c431bef21e608229ba1fc26419f08d67cd` | `/root/review_issue022a_final` | FAIL | 0/2/2 | opaque PathUri canonical roundtrip 与 MCP `arguments:null` 仍有偏差；Linux trailing-slash shell 语义和 clean-shell generator 文档不足。 |
| 第三次整改，审查一 | `03f9595315a88abeef672734e451a65c51393cef` | `/root/review_issue022a_commit` | PASS | 0/0/0 | 当次检查未发现阻断问题。 |
| 第三次整改，审查二 | `03f9595315a88abeef672734e451a65c51393cef` | `/root/review_issue022a_final` | FAIL | 0/0/1 | 发现 Rust `Path::file_stem()` 的 `/bin/bash/.` 路径边界未完整覆盖；审查时还发现未跟踪的预写 PASS 草稿使 clean-tree 门禁失败，草稿随后删除且未进入提交。 |
| 第四次整改，审查一 | `04caaec32650ec754dd7eb152c9d78467da7ff57` | `/root/review_issue022a_commit` | FAIL | 0/0/1 | 84 项 wrapper corpus 大量使用不可观察参数，PowerShell canonicalization 信号不足。 |
| 第四次整改，审查二 | `04caaec32650ec754dd7eb152c9d78467da7ff57` | `/root/review_issue022a_final` | FAIL | 0/0/1 | 独立确认同一 PowerShell oracle 不可判别覆盖缺陷；未发现新的运行时语义偏差。 |
| 最终候选，复核一 | `4b9da8abaea756b98543df68811699e90929304d` | `/root/review_issue022a_commit` | PASS | 0/0/0 | 真实 Rust oracle、可判别 shell 分区、构建、类型、pack、policy、inventory 与 diff 门禁通过。 |
| 最终候选，复核二 | `4b9da8abaea756b98543df68811699e90929304d` | `/root/review_issue022a_final` | PASS | 0/0/0 | 独立重生成 oracle 与 golden 一致；84 fixture 唯一且信号/检测计数、历史路径/权限/MCP/Guardian 边界均无回归。 |

`03f95953` 的一次 PASS 没有覆盖另一独立审查发现的 P2，因此没有被当作最终批准。只有 `4b9da8...` 上两位不同审查代理的 PASS 被写入 manifest 的强制 review 字段。

## 修复映射

1. `4245331f9e530bf3c7f67aa79ec52ad1ed9731ab`
   - 补齐 PathUri query/fragment/NUL、ApplyPatch strict path、强类型 fixture 与测试类型门禁。
   - 将 Guardian fixture 明确区分为 source-derived，并开始锁定固定上游输入。
2. `a54493c431bef21e608229ba1fc26419f08d67cd`
   - 分离 PathUri 序列化与 Eq/Hash 身份，加入 POSIX opaque bytes 受控表示。
   - 对齐 PermissionProfile legacy/canonical serde、special path、null 与错误边界。
   - 以真实固定上游 Guardian 私有实现生成 oracle，并删除手写 DTO 自证路径。
3. `03f9595315a88abeef672734e451a65c51393cef`
   - 修复 opaque URI re-encode 验证、Guardian cwd/lossy seam、MCP null 保留和 shell trailing slash 边界。
   - 修复 clean SSH 工具链发现与 generator 可复现性。
4. `04caaec32650ec754dd7eb152c9d78467da7ff57`
   - 以通用 Rust Path 词法递归替代样例特判，并扩展 84 项路径语法 corpus。
5. `4b9da8abaea756b98543df68811699e90929304d`
   - Bash 使用 `-lc`、PowerShell 使用 `-Command`/`-c` 产生可观察 canonical signal。
   - oracle 直接调用固定上游 `detect_shell_type`；TS 逐项差分并硬断言信号与检测分区计数。

## 最终实现映射

### approval-action-and-cache

- `src/codex-parity/types.ts`：7 种 `ApprovalAction`、cache key、permission hook 和权限协议类型。
- `src/codex-parity/approval-action.ts`：`permissionRequestPayload`、`approvalCacheKeys`。
- `src/codex-parity/command-canonicalization.ts`：`canonicalizeCommandForApproval`、Bash 解析与 shlex join。
- `src/codex-parity/path.ts`：PathUri/AbsolutePath/LegacyAppPath、opaque POSIX bytes 与 cache identity。
- `src/codex-parity/permission-profile.ts`、`src/codex-parity/validation.ts`：上游 serde 与整数约束。

### guardian-action-format

- `src/codex-parity/guardian-request.ts`：真实 Guardian request 转换、稳定 JSON、递归截断、pretty format、assessment/reviewed analytics。
- `src/codex-parity/types.ts`：Guardian request/event/action 强类型协议。
- `src/codex-parity/path.ts`、`src/codex-parity/permission-profile.ts`：Guardian cwd 和权限序列化 seam。

## 最终测试证据

固定上游 oracle：

- Rust：`1 passed; 0 failed; 2381 filtered out`
- golden：62,426 bytes
- SHA-256：`736f37e91bb8c2ef125b8600b556296bd7e88d43685a62c62bc23d425c9a5743`
- 84 个 wrapper fixture 全部唯一。
- signal：Bash 27、PowerShell 24、raw 33。
- detector：bash 25、powershell 24、sh 1、zsh 1、cmd 1、none 32。
- 旧 Bash/PathUri/shlex oracle 重生成稳定 SHA-256：`66794093d7ab4efe6b28be7cb8f51e4741ef67aa0bb83c5b69c1c2a6a34b491f`。

Node 24 与仓库门禁：

- `npm run build`：PASS。
- `npm run test:types`：PASS。
- parity 定向：3 files / 52 tests PASS。
- `npx vitest run --exclude tests/linux-sandbox.spec.ts`：20 files / 144 tests PASS。
- `npm run pack:verify`：PASS，packed artifact 可离线导入。
- `npm run policy:check`：PASS。
- source/inventory：15 modules / 267 locked upstream files PASS。
- oracle wrapper fault gate：`toolchain_rc=127 lock_rc=1 signal_rc=143 cleanup=absent`。
- `git diff --check` 与提交范围 `git diff-tree --check`：PASS。

完整 `npm test` 在审查执行环境中为 144 PASS、1 个环境失败：`tests/linux-sandbox.spec.ts` 无权创建 `/work/.sandbox-e2e/workspace`，错误为 `EACCES`。该项没有被记作功能 PASS；可运行测试集合单独全绿。最终候选完整工作树 clean。

## 最终结论

`/root/review_issue022a_commit` 与 `/root/review_issue022a_final` 均在精确提交 `4b9da8...` 上给出 PASS，P0/P1/P2 均为 0。证据仅批准上述两个 ISSUE-022A 模块；manifest 中其他模块保持原状态，整体 release gate 应继续失败直到其余模块完成或有合格 N/A 证明。
