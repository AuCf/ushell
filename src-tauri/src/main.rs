// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use ssh2::Session;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static TEMP_KEY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(serde::Serialize)]
struct TestSshResult {
    success: bool,
    latency_ms: u128,
    banner: String,
    message: String,
}

#[derive(serde::Serialize)]
struct SshCommandResult {
    stdout: String,
    stderr: String,
    exit_status: i32,
    current_dir: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SftpItemResult {
    name: String,
    path: String,
    is_directory: bool,
    size: u64,
    modified_time: String,
    permissions: String,
    owner: Option<String>,
}

#[derive(serde::Serialize)]
struct SftpDirectoryResult {
    path: String,
    items: Vec<SftpItemResult>,
}

struct SshCredentials {
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: String,
}

struct TempPrivateKey {
    path: PathBuf,
}

impl TempPrivateKey {
    fn create(contents: &str) -> Result<Self, String> {
        let temp_dir = std::env::temp_dir();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();

        for _ in 0..10 {
            let sequence = TEMP_KEY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = temp_dir.join(format!(
                "mashell-ssh-key-{}-{}-{}",
                std::process::id(),
                timestamp,
                sequence
            ));
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);

            match options.open(&path) {
                Ok(mut file) => {
                    let key = Self { path };
                    file.write_all(contents.as_bytes())
                        .and_then(|_| file.flush())
                        .map_err(|error| format!("写入临时 SSH 私钥失败: {}", error))?;

                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        fs::set_permissions(&key.path, fs::Permissions::from_mode(0o600))
                            .map_err(|error| format!("设置临时 SSH 私钥权限失败: {}", error))?;
                    }

                    return Ok(key);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("创建临时 SSH 私钥失败: {}", error)),
            }
        }

        Err("无法创建唯一的临时 SSH 私钥文件".to_string())
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempPrivateKey {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn validate_credentials(credentials: &SshCredentials) -> Result<(), String> {
    if credentials.host.trim().is_empty() {
        return Err("主机 IP 或域名不能为空".to_string());
    }
    if credentials.username.trim().is_empty() {
        return Err("请输入 SSH 登录用户名 (如 root)".to_string());
    }

    match credentials.auth_type.as_str() {
        "password" if credentials.password.as_deref().unwrap_or("").is_empty() => {
            Err("密码未填写，请输入 SSH 认证密码".to_string())
        }
        "privateKey"
            if !credentials
                .private_key
                .as_deref()
                .unwrap_or("")
                .contains("PRIVATE KEY") =>
        {
            Err("SSH 私钥格式无效，请粘贴完整的 PEM/OpenSSH 私钥内容".to_string())
        }
        "password" | "privateKey" => Ok(()),
        _ => Err("不支持的 SSH 认证方式".to_string()),
    }
}

fn connect_tcp(host: &str, port: u16) -> Result<TcpStream, String> {
    let addr = format!("{}:{}", host.trim(), port);
    let addresses = addr
        .to_socket_addrs()
        .map_err(|error| format!("域名/IP 解析失败 '{}': {}", host.trim(), error))?
        .collect::<Vec<SocketAddr>>();

    if addresses.is_empty() {
        return Err(format!("无法找到主机 '{}' 的有效 IP 地址", host.trim()));
    }

    let mut last_error = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, Duration::from_secs(8)) {
            Ok(stream) => {
                stream
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .map_err(|error| format!("设置 SSH 读取超时失败: {}", error))?;
                stream
                    .set_write_timeout(Some(Duration::from_secs(10)))
                    .map_err(|error| format!("设置 SSH 写入超时失败: {}", error))?;
                return Ok(stream);
            }
            Err(error) => last_error = Some(error),
        }
    }

    Err(format!(
        "无法连接 {}:{}，请检查地址、端口和防火墙: {}",
        host.trim(),
        port,
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "未知网络错误".to_string())
    ))
}

fn connect_and_authenticate(credentials: &SshCredentials) -> Result<Session, String> {
    validate_credentials(credentials)?;
    let tcp = connect_tcp(&credentials.host, credentials.port)?;
    let mut session = Session::new().map_err(|error| format!("创建 SSH 会话失败: {}", error))?;
    session.set_timeout(10_000);
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|error| format!("SSH 握手失败: {}", error))?;

    match credentials.auth_type.as_str() {
        "password" => session
            .userauth_password(
                credentials.username.trim(),
                credentials.password.as_deref().unwrap_or(""),
            )
            .map_err(|error| format!("SSH 用户名或密码认证失败: {}", error))?,
        "privateKey" => {
            let private_key =
                TempPrivateKey::create(credentials.private_key.as_deref().unwrap_or(""))?;
            session
                .userauth_pubkey_file(credentials.username.trim(), None, private_key.path(), None)
                .map_err(|error| format!("SSH 私钥认证失败: {}", error))?;
        }
        _ => return Err("不支持的 SSH 认证方式".to_string()),
    }

    if !session.authenticated() {
        return Err("SSH 服务器拒绝了认证凭据".to_string());
    }

    Ok(session)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn format_permissions(mode: Option<u32>, is_directory: bool) -> String {
    let mode = mode.unwrap_or(0);
    let mut result = String::with_capacity(10);
    result.push(if is_directory { 'd' } else { '-' });
    for bit in [
        0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001,
    ] {
        result.push(if mode & bit != 0 {
            match bit {
                0o400 | 0o040 | 0o004 => 'r',
                0o200 | 0o020 | 0o002 => 'w',
                _ => 'x',
            }
        } else {
            '-'
        });
    }
    result
}

fn remote_join(parent: &str, name: &str) -> String {
    if parent == "/" {
        format!("/{}", name)
    } else {
        format!("{}/{}", parent.trim_end_matches('/'), name)
    }
}

#[tauri::command]
async fn test_ssh_connection(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: String,
) -> Result<TestSshResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let credentials = SshCredentials {
            host,
            port,
            username,
            password,
            private_key,
            auth_type,
        };
        let start = Instant::now();
        let session = connect_and_authenticate(&credentials)?;
        let banner = session.banner().unwrap_or("SSH-2.0").trim().to_string();
        let latency = start.elapsed().as_millis();

        Ok(TestSshResult {
            success: true,
            latency_ms: latency,
            banner: banner.clone(),
            message: format!("SSH 握手及身份认证成功 ({})，耗时 {}ms", banner, latency),
        })
    })
    .await
    .map_err(|error| format!("SSH 连接任务异常: {}", error))?
}

#[tauri::command]
async fn execute_ssh_command(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: String,
    command: String,
    current_dir: String,
) -> Result<SshCommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if command.trim().is_empty() {
            return Err("远程命令不能为空".to_string());
        }

        let credentials = SshCredentials {
            host,
            port,
            username,
            password,
            private_key,
            auth_type,
        };
        let session = connect_and_authenticate(&credentials)?;
        let mut channel = session
            .channel_session()
            .map_err(|error| format!("创建 SSH 命令通道失败: {}", error))?;
        let marker = "__MASHELL_CURRENT_DIR__";
        let target_dir = if current_dir.trim() == "~" {
            "$HOME".to_string()
        } else {
            shell_quote(if current_dir.trim().is_empty() { "." } else { current_dir.trim() })
        };
        let wrapped_command = format!(
            "cd -- {} && {{ {}; __mashell_status=$?; printf '\\n{}%s\\n' \"$PWD\"; exit $__mashell_status; }}",
            target_dir,
            command,
            marker
        );

        channel
            .exec(&wrapped_command)
            .map_err(|error| format!("发送远程命令失败: {}", error))?;

        let mut stdout = String::new();
        channel
            .read_to_string(&mut stdout)
            .map_err(|error| format!("读取远程命令输出失败: {}", error))?;
        let mut stderr = String::new();
        channel
            .stderr()
            .read_to_string(&mut stderr)
            .map_err(|error| format!("读取远程错误输出失败: {}", error))?;
        channel
            .wait_close()
            .map_err(|error| format!("关闭 SSH 命令通道失败: {}", error))?;
        let exit_status = channel
            .exit_status()
            .map_err(|error| format!("读取远程退出状态失败: {}", error))?;

        let mut resolved_dir = current_dir;
        if let Some(marker_index) = stdout.rfind(marker) {
            resolved_dir = stdout[marker_index + marker.len()..].trim().to_string();
            stdout.truncate(marker_index);
            stdout = stdout.trim_end_matches(['\r', '\n']).to_string();
        }

        Ok(SshCommandResult {
            stdout,
            stderr,
            exit_status,
            current_dir: resolved_dir,
        })
    })
    .await
    .map_err(|error| format!("SSH 命令任务异常: {}", error))?
}

#[tauri::command]
async fn list_sftp_directory(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: String,
    path: String,
) -> Result<SftpDirectoryResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let credentials = SshCredentials {
            host,
            port,
            username,
            password,
            private_key,
            auth_type,
        };
        let session = connect_and_authenticate(&credentials)?;
        let sftp = session
            .sftp()
            .map_err(|error| format!("初始化 SFTP 会话失败: {}", error))?;
        let requested_path = if path.trim().is_empty() {
            "."
        } else {
            path.trim()
        };
        let resolved_path = sftp
            .realpath(Path::new(requested_path))
            .map_err(|error| format!("无法访问远程目录 '{}': {}", requested_path, error))?
            .to_string_lossy()
            .replace('\\', "/");
        let entries = sftp
            .readdir(Path::new(&resolved_path))
            .map_err(|error| format!("读取远程目录 '{}' 失败: {}", resolved_path, error))?;

        let mut items = entries
            .into_iter()
            .filter_map(|(entry_path, stat)| {
                let name = entry_path.file_name()?.to_string_lossy().to_string();
                let is_directory = stat.is_dir();
                Some(SftpItemResult {
                    path: remote_join(&resolved_path, &name),
                    name,
                    is_directory,
                    size: stat.size.unwrap_or(0),
                    modified_time: stat
                        .mtime
                        .map(|value| value.to_string())
                        .unwrap_or_default(),
                    permissions: format_permissions(stat.perm, is_directory),
                    owner: stat.uid.map(|value| value.to_string()),
                })
            })
            .collect::<Vec<_>>();

        items.sort_by(|left, right| {
            right
                .is_directory
                .cmp(&left.is_directory)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });

        Ok(SftpDirectoryResult {
            path: resolved_path,
            items,
        })
    })
    .await
    .map_err(|error| format!("SFTP 目录任务异常: {}", error))?
}

#[tauri::command]
async fn create_sftp_directory(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: String,
    parent_path: String,
    folder_name: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder_name = folder_name.trim();
        if folder_name.is_empty()
            || folder_name == "."
            || folder_name == ".."
            || folder_name.contains('/')
            || folder_name.contains('\\')
        {
            return Err("目录名称无效，不能包含路径分隔符".to_string());
        }

        let credentials = SshCredentials {
            host,
            port,
            username,
            password,
            private_key,
            auth_type,
        };
        let session = connect_and_authenticate(&credentials)?;
        let sftp = session
            .sftp()
            .map_err(|error| format!("初始化 SFTP 会话失败: {}", error))?;
        let target_path = remote_join(parent_path.trim_end_matches('/'), folder_name);
        sftp.mkdir(Path::new(&target_path), 0o755)
            .map_err(|error| format!("创建远程目录 '{}' 失败: {}", target_path, error))
    })
    .await
    .map_err(|error| format!("SFTP 新建目录任务异常: {}", error))?
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            test_ssh_connection,
            execute_ssh_command,
            list_sftp_directory,
            create_sftp_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
