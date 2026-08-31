use std::path::PathBuf;
use crate::shell_detect::{detect_shell_type, ShellType};

const POWERSHELL_FLAGS: &[&str] = &["-nologo", "-noprofile", "-command", "-c"];

// Exact extract_powershell_command implementation used by Codex 9f97cb79.
pub fn extract_powershell_command(command: &[String]) -> Option<(&str, &str)> {
    if command.len() < 3 { return None; }
    let shell = &command[0];
    if !matches!(detect_shell_type(PathBuf::from(shell)), Some(ShellType::PowerShell)) { return None; }
    let mut i = 1usize;
    while i + 1 < command.len() {
        let flag = &command[i];
        if !POWERSHELL_FLAGS.contains(&flag.to_ascii_lowercase().as_str()) { return None; }
        if flag.eq_ignore_ascii_case("-Command") || flag.eq_ignore_ascii_case("-c") {
            return Some((shell, &command[i + 1]));
        }
        i += 1;
    }
    None
}
