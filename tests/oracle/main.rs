mod bash;
mod powershell;
mod shell_detect;

use bash::{extract_bash_command, parse_shell_lc_plain_commands};
use powershell::extract_powershell_command;
use codex_utils_path_uri::PathUri;
use serde::Serialize;
use serde_json::{json, Value};

const COMMIT: &str = "9f97cb79eb";

fn shlex_join(command: &[&str]) -> String {
    shlex::try_join(command.iter().copied()).unwrap_or_else(|_| "<command included NUL byte>".to_string())
}

fn canonicalize(command: &[String]) -> Vec<String> {
    if let Some(commands) = parse_shell_lc_plain_commands(command)
        && let [single] = commands.as_slice()
    { return single.clone(); }
    if let Some((_shell, script)) = extract_bash_command(command) {
        return vec!["__codex_shell_script__".into(), command.get(1).cloned().unwrap_or_default(), script.into()];
    }
    if let Some((_shell, script)) = extract_powershell_command(command) {
        return vec!["__codex_powershell_script__".into(), script.into()];
    }
    command.to_vec()
}

#[derive(Serialize)]
struct Command<'a> {
    tool: &'a str, command: &'a [&'a str], cwd: &'a str, sandbox_permissions: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")] additional_permissions: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] justification: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")] tty: Option<bool>,
}
#[derive(Serialize)]
struct WriteStdin<'a> {
    tool: &'static str, environment_id: &'a str, session_id: i32, chars: &'a str, cwd: &'a str,
    sandbox_permissions: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")] additional_permissions: Option<Value>, tty: bool,
}
#[derive(Serialize)]
struct Execve<'a> {
    tool: &'a str, program: &'a str, argv: &'a [&'a str], cwd: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")] additional_permissions: Option<Value>,
}
#[derive(Serialize)] struct ApplyPatch<'a> { tool: &'static str, cwd: &'a str, files: &'a [&'a str], patch: &'a str }
#[derive(Serialize)]
struct Mcp<'a> {
    tool: &'static str, server: &'a str, tool_name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")] arguments: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] connector_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")] connector_name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")] connector_description: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")] connected_account_email: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")] tool_title: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")] tool_description: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")] annotations: Option<Value>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Trigger<'a> {
    call_id: &'a str, tool_name: &'a str, command: &'a [&'a str], cwd: PathUri,
    sandbox_permissions: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")] additional_permissions: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")] justification: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")] tty: Option<bool>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Network<'a> {
    tool: &'static str, target: &'a str, host: &'a str, protocol: &'a str, port: u16,
    #[serde(skip_serializing_if = "Option::is_none")] trigger: Option<Trigger<'a>>,
}
#[derive(Serialize)]
struct Permissions<'a> {
    tool: &'static str, turn_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")] reason: Option<&'a str>, permissions: Value,
}

fn guardian_goldens() -> Vec<Value> {
    let additional = json!({"network":{"enabled":true}});
    vec![
        json!({"name":"exec_command/minimal","json":serde_json::to_value(Command { tool:"exec_command",command:&["echo","hi"],cwd:"/work",sandbox_permissions:"use_default",additional_permissions:None,justification:None,tty:Some(false) }).unwrap()}),
        json!({"name":"exec_command/options","json":serde_json::to_value(Command { tool:"exec_command",command:&["curl","x"],cwd:"/work",sandbox_permissions:"with_additional_permissions",additional_permissions:Some(additional.clone()),justification:Some("network"),tty:Some(true) }).unwrap()}),
        json!({"name":"write_stdin/minimal","json":serde_json::to_value(WriteStdin { tool:"write_stdin",environment_id:"local",session_id:7,chars:"",cwd:"/work",sandbox_permissions:"use_default",additional_permissions:None,tty:false }).unwrap()}),
        json!({"name":"write_stdin/options","json":serde_json::to_value(WriteStdin { tool:"write_stdin",environment_id:"local",session_id:7,chars:"yes\n",cwd:"/work",sandbox_permissions:"with_additional_permissions",additional_permissions:Some(additional.clone()),tty:true }).unwrap()}),
        json!({"name":"execve/minimal","json":serde_json::to_value(Execve { tool:"exec_command",program:"/bin/echo",argv:&["echo","hi"],cwd:"/work",additional_permissions:None }).unwrap()}),
        json!({"name":"execve/options","json":serde_json::to_value(Execve { tool:"shell",program:"/bin/bash",argv:&["bash","-lc","echo hi"],cwd:"/work",additional_permissions:Some(additional.clone()) }).unwrap()}),
        json!({"name":"apply_patch","json":serde_json::to_value(ApplyPatch { tool:"apply_patch",cwd:"/work",files:&["/work/a.ts"],patch:"*** Begin Patch\n*** End Patch" }).unwrap()}),
        json!({"name":"mcp/minimal","json":serde_json::to_value(Mcp { tool:"mcp_tool_call",server:"srv",tool_name:"read",arguments:None,connector_id:None,connector_name:None,connector_description:None,connected_account_email:None,tool_title:None,tool_description:None,annotations:None }).unwrap()}),
        json!({"name":"mcp/options","json":serde_json::to_value(Mcp { tool:"mcp_tool_call",server:"srv",tool_name:"write",arguments:Some(json!({"z":1,"a":"x"})),connector_id:Some("cid"),connector_name:Some("conn"),connector_description:Some("desc"),connected_account_email:Some("a@example.test"),tool_title:Some("Write"),tool_description:Some("writes"),annotations:Some(json!({"destructive_hint":true,"open_world_hint":false,"read_only_hint":false})) }).unwrap()}),
        json!({"name":"network/minimal","json":serde_json::to_value(Network { tool:"network_access",target:"example.test:443",host:"example.test",protocol:"https",port:443,trigger:None }).unwrap()}),
        json!({"name":"network/options","json":serde_json::to_value(Network { tool:"network_access",target:"example.test:443",host:"example.test",protocol:"https",port:443,trigger:Some(Trigger { call_id:"call",tool_name:"exec_command",command:&["curl","https://example.test"],cwd:PathUri::parse("file:///work").unwrap(),sandbox_permissions:"with_additional_permissions",additional_permissions:Some(additional.clone()),justification:Some("fetch"),tty:Some(false) }) }).unwrap()}),
        json!({"name":"request_permissions/minimal","json":serde_json::to_value(Permissions { tool:"request_permissions",turn_id:"turn",reason:None,permissions:json!({}) }).unwrap()}),
        json!({"name":"request_permissions/options","json":serde_json::to_value(Permissions { tool:"request_permissions",turn_id:"turn",reason:Some("write"),permissions:json!({"file_system":{"write":["/work"]}}) }).unwrap()}),
    ]
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
        json!({"script":script,"parsed":parse_shell_lc_plain_commands(&argv),"canonical":canonicalize(&argv)})
    }).collect::<Vec<_>>();
    let path_uris = ["file:///work", "file://localhost/work", "file:///c:/work", "file:///d%3a/work", "file:///work?x=1", "file:///work#f", "file:///work/%00/plain", "file:///%00/bad/path/L3RtcC9h"]
        .iter().map(|input| match PathUri::parse(input) {
            Ok(uri) => json!({"input":input,"ok":uri.to_string()}),
            Err(error) => json!({"input":input,"error":error.to_string()}),
        }).collect::<Vec<_>>();
    let shlex = [vec!["echo","hello"],vec!["echo","hello world"],vec![""],vec!["a'b"],vec!["a$b"],vec!["ümlaut"],vec!["printf","a\0b"]]
        .iter().map(|v| json!({"argv":v,"joined":shlex_join(v)})).collect::<Vec<_>>();
    println!("{}", serde_json::to_string_pretty(&json!({
        "codex_commit":COMMIT,
        "source_blobs": {
            "bash.rs":"ddd5807bfce5d1a54796e7a557b77d589be14d35",
            "path_uri/lib.rs":"3eb754bf6e28b52f57bfd4a39a260e0e426d0971",
            "tools/approvals.rs":"5da0a46c74a9482f74158e7101ce7fc25403a2f5",
            "guardian/approval_request.rs":"786c3eedf0b40cf2a5ef1f0682b0bad0a7125792"
        },
        "guardian_fixture_kind":"source-derived-private-serde-dto",
        "shell_corpus":shell,"path_uri":path_uris,"shlex":shlex,"guardian_actions":guardian_goldens()
    })).unwrap());
}
