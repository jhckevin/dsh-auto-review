mod bash;
mod shell_detect;

use bash::parse_shell_lc_plain_commands;
use codex_utils_path_uri::PathUri;
use serde_json::json;

const COMMIT: &str = "9f97cb79eb15b38d24c552c56fe24e211ff9cf3a";

fn shlex_join(command: &[&str]) -> String {
    shlex::try_join(command.iter().copied()).unwrap_or_else(|_| "<command included NUL byte>".to_string())
}

fn main() {
    let scripts = [
        "ls -1", "ls && pwd; echo 'hi there' | wc -l", "echo \"hello world\"", "echo 'hi there'",
        "git commit -m \"line1\nline2\"", "echo \"/usr\"'/'\"local\"/bin", "echo '/usr'\"/\"'local'/bin",
        "echo \"hi ${USER}\"", "echo \"$HOME\"", "echo 123 456", "(ls)", "ls || (pwd && echo hi)",
        "ls > out.txt", "echo hi & echo bye", "echo $(pwd)", "echo `pwd`", "echo $HOME", "echo \"hi $USER\"",
        "find . -{delete,print}", "rg --pre{=,=sh} pattern payload.sh", "find . -del*", "find . -delet?",
        "find . -delet[e]", r"find . -de\lete", "echo ~", "echo ~HOME", "echo HEAD~1", "echo HEAD^",
        "echo file~", "echo =sh", "echo foo^bar", "echo foo#bar", "l* -l", r#"rg -g"*.py" pattern"#,
        r#"echo "\n""#, r#"echo "~HOME" 'HEAD~1' "HEAD^" 'foo#bar' "=sh" 'file~'"#,
        r#"echo -"{a,b}" '*?[]~^#=\\'"#, r#"echo "\$HOME\`\"\\\n""#, "find . \"-de\\\nlete\"",
        r#"echo "\\""#, "FOO=bar ls", "ls &&", "&& ls", "ls ;; pwd", "ls | | wc",
        "rg -n \"foo\" -g\"*.py\"", "grep -n 'pattern' -g'*.txt'", "rg -g\"$VAR\" pattern",
        "rg -g\"${VAR}\" pattern", "rg -g\"$(pwd)\" pattern", "rg -g\"$(echo '*.py')\" pattern",
        "echo hi;", "case \"$x\" in a) echo a;; esac", "for x in a; do echo \"$x\"; done",
    ];
    let shell = scripts.iter().map(|script| {
        let argv = vec!["bash".to_string(), "-lc".to_string(), (*script).to_string()];
        json!({"script":script,"parsed":parse_shell_lc_plain_commands(&argv)})
    }).collect::<Vec<_>>();
    let path_uris = ["file:///work", "file://localhost/work", "file:///c:/work", "file:///d%3a/work", "file:///work?x=1", "file:///work#f", "file:///work/%00/plain", "file:///%00/bad/path/L3RtcC9h"]
        .iter().map(|input| match PathUri::parse(input) {
            Ok(uri) => json!({"input":input,"ok":uri.to_string(),"to_abs_path":uri.to_abs_path().map(|path|path.display().to_string()).map_err(|error|error.to_string())}),
            Err(error) => json!({"input":input,"error":error.to_string()}),
        }).collect::<Vec<_>>();
    let shlex = [vec!["echo","hello"],vec!["echo","hello world"],vec![""],vec!["a'b"],vec!["a$b"],vec!["ümlaut"],vec!["printf","a\0b"]]
        .iter().map(|v| json!({"argv":v,"joined":shlex_join(v)})).collect::<Vec<_>>();
    println!("{}", serde_json::to_string_pretty(&json!({
        "codex_commit":COMMIT,
        "source_blobs": {
            "bash.rs":"ddd5807bfce5d1a54796e7a557b77d589be14d35",
            "path_uri/lib.rs":"3eb754bf6e28b52f57bfd4a39a260e0e426d0971"
        },
        "shell_corpus":shell,"path_uri":path_uris,"shlex":shlex
    })).unwrap());
}
