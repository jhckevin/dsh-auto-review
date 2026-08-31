use std::path::Path;

#[derive(Clone, Copy)]
pub enum ShellType { Zsh, Bash, PowerShell, Sh, Cmd }

// Exact detect_shell_type implementation used by Codex 9f97cb79; unrelated
// user-account shell discovery below it in the upstream file is intentionally
// excluded from the oracle crate.
pub fn detect_shell_type(shell_path: impl AsRef<Path>) -> Option<ShellType> {
    let shell_path = shell_path.as_ref();
    match shell_path.as_os_str().to_str() {
        Some("zsh") => Some(ShellType::Zsh),
        Some("sh") => Some(ShellType::Sh),
        Some("cmd") => Some(ShellType::Cmd),
        Some("bash") => Some(ShellType::Bash),
        Some("pwsh") => Some(ShellType::PowerShell),
        Some("powershell") => Some(ShellType::PowerShell),
        _ => {
            let shell_name = shell_path.file_stem();
            if let Some(shell_name) = shell_name {
                let shell_name_path = Path::new(shell_name);
                if shell_name_path != shell_path { return detect_shell_type(shell_name_path); }
            }
            None
        }
    }
}
