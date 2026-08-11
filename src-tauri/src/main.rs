// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use ssh2::{OpenFlags, OpenType, Session};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static TEMP_KEY_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const MAX_SFTP_TRANSFER_BYTES: usize = 64 * 1024 * 1024;

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

#[derive(serde::Serialize)]
struct SftpDownloadResult {
    name: String,
    content: Vec<u8>,
}

#[derive(serde::Serialize)]
struct SftpUploadBatchResult {
    uploaded: usize,
    directories: usize,
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

fn validate_relative_remote_path(path: &str) -> Result<Vec<&str>, String> {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') || path.contains('\0') {
        return Err("远程相对路径无效".to_string());
    }

    let components: Vec<&str> = path.split('/').collect();
    if components
        .iter()
        .any(|component| component.is_empty() || *component == "." || *component == "..")
    {
        return Err("远程相对路径不能包含空目录、'.' 或 '..'".to_string());
    }
    Ok(components)
}

fn ensure_remote_directory(
    sftp: &ssh2::Sftp,
    parent_path: &str,
    relative_path: &str,
) -> Result<String, String> {
    let mut current_path = parent_path.trim_end_matches('/').to_string();
    for component in validate_relative_remote_path(relative_path)? {
        current_path = remote_join(&current_path, component);
        match sftp.stat(Path::new(&current_path)) {
            Ok(stat) if stat.is_dir() => {}
            Ok(_) => return Err(format!("远程路径 '{}' 已存在且不是目录", current_path)),
            Err(_) => sftp
                .mkdir(Path::new(&current_path), 0o755)
                .map_err(|error| format!("创建远程目录 '{}' 失败: {}", current_path, error))?,
        }
    }
    Ok(current_path)
}

fn local_file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .ok_or_else(|| format!("无法识别本地路径名称: {}", path.display()))
}

fn collect_local_upload_entries(
    local_path: &Path,
    relative_path: String,
    files: &mut Vec<(PathBuf, String)>,
    directories: &mut Vec<String>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(local_path)
        .map_err(|error| format!("读取本地路径 '{}' 失败: {}", local_path.display(), error))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("暂不支持上传符号链接: {}", local_path.display()));
    }
    if metadata.is_file() {
        files.push((local_path.to_path_buf(), relative_path));
        return Ok(());
    }
    if !metadata.is_dir() {
        return Err(format!("不支持的本地文件类型: {}", local_path.display()));
    }

    directories.push(relative_path.clone());
    let mut children = fs::read_dir(local_path)
        .map_err(|error| format!("读取本地目录 '{}' 失败: {}", local_path.display(), error))?
        .map(|entry| {
            entry
                .map(|value| value.path())
                .map_err(|error| format!("读取本地目录项失败: {}", error))
        })
        .collect::<Result<Vec<_>, _>>()?;
    children.sort();
    for child in children {
        let child_name = local_file_name(&child)?;
        collect_local_upload_entries(
            &child,
            format!("{}/{}", relative_path, child_name),
            files,
            directories,
        )?;
    }
    Ok(())
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
async fn complete_ssh_input(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: String,
    line: String,
    current_dir: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prefix = if line.chars().last().is_some_and(char::is_whitespace) {
            ""
        } else {
            line.split_whitespace().last().unwrap_or("")
        };
        let prefix_start = line.len().saturating_sub(prefix.len());
        let is_command_position = line[..prefix_start].trim().is_empty();
        let quoted_prefix = shell_quote(prefix);
        let completion_script = if is_command_position {
            format!(
                "compgen -A command -- {} | LC_ALL=C sort -u | head -n 200",
                quoted_prefix
            )
        } else {
            format!(
                "while IFS= read -r item; do if [ -d \"$item\" ]; then printf '%s/\\n' \"$item\"; else printf '%s\\n' \"$item\"; fi; done < <(compgen -f -- {}) | LC_ALL=C sort -u | head -n 200",
                quoted_prefix
            )
        };

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
            .map_err(|error| format!("创建 SSH 补全通道失败: {}", error))?;
        let target_dir = if current_dir.trim() == "~" {
            "$HOME".to_string()
        } else {
            shell_quote(if current_dir.trim().is_empty() {
                "."
            } else {
                current_dir.trim()
            })
        };
        let command = format!(
            "cd -- {} && bash -c {}",
            target_dir,
            shell_quote(&completion_script)
        );
        channel
            .exec(&command)
            .map_err(|error| format!("发送 SSH 补全请求失败: {}", error))?;

        let mut stdout = String::new();
        channel
            .read_to_string(&mut stdout)
            .map_err(|error| format!("读取 SSH 补全结果失败: {}", error))?;
        let mut stderr = String::new();
        channel
            .stderr()
            .read_to_string(&mut stderr)
            .map_err(|error| format!("读取 SSH 补全错误失败: {}", error))?;
        channel
            .wait_close()
            .map_err(|error| format!("关闭 SSH 补全通道失败: {}", error))?;
        let exit_status = channel
            .exit_status()
            .map_err(|error| format!("读取 SSH 补全状态失败: {}", error))?;
        if exit_status != 0 && !stderr.trim().is_empty() {
            return Err(format!("远程补全失败: {}", stderr.trim()));
        }

        Ok(stdout
            .lines()
            .map(|candidate| {
                candidate
                    .chars()
                    .filter(|character| !character.is_control())
                    .collect::<String>()
            })
            .filter(|candidate| !candidate.is_empty())
            .collect())
    })
    .await
    .map_err(|error| format!("SSH 补全任务异常: {}", error))?
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

#[tauri::command]
async fn upload_sftp_file(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: String,
    parent_path: String,
    relative_path: String,
    content: Vec<u8>,
    overwrite: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path_components = validate_relative_remote_path(&relative_path)?;
        if content.len() > MAX_SFTP_TRANSFER_BYTES {
            return Err(format!(
                "单个上传文件不能超过 {} MB",
                MAX_SFTP_TRANSFER_BYTES / 1024 / 1024
            ));
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
        let file_name = path_components
            .last()
            .ok_or_else(|| "上传文件名称无效".to_string())?;
        let directory_path = path_components[..path_components.len() - 1].join("/");
        let upload_parent = if directory_path.is_empty() {
            parent_path.trim_end_matches('/').to_string()
        } else {
            ensure_remote_directory(&sftp, &parent_path, &directory_path)?
        };
        let target_path = remote_join(&upload_parent, file_name);

        if !overwrite && sftp.stat(Path::new(&target_path)).is_ok() {
            return Err(format!("SFTP_FILE_EXISTS:{}", relative_path));
        }

        let mut remote_file = sftp
            .open_mode(
                Path::new(&target_path),
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
                0o644,
                OpenType::File,
            )
            .map_err(|error| format!("打开远程文件 '{}' 失败: {}", target_path, error))?;
        remote_file
            .write_all(&content)
            .and_then(|_| remote_file.flush())
            .map_err(|error| format!("上传远程文件 '{}' 失败: {}", target_path, error))
    })
    .await
    .map_err(|error| format!("SFTP 上传任务异常: {}", error))?
}

#[tauri::command]
async fn create_sftp_directory_tree(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: String,
    parent_path: String,
    mut directories: Vec<String>,
) -> Result<(), String> {
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

        directories.sort();
        directories.dedup();
        for directory in directories {
            ensure_remote_directory(&sftp, &parent_path, &directory)?;
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("SFTP 创建目录树任务异常: {}", error))?
}

#[tauri::command]
async fn upload_sftp_local_paths(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: String,
    parent_path: String,
    local_paths: Vec<String>,
    overwrite: bool,
) -> Result<SftpUploadBatchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if local_paths.is_empty() {
            return Err("没有收到需要上传的本地文件或目录".to_string());
        }

        let mut files = Vec::new();
        let mut directories = Vec::new();
        for local_path in local_paths {
            let path = PathBuf::from(local_path);
            let relative_path = local_file_name(&path)?;
            validate_relative_remote_path(&relative_path)?;
            collect_local_upload_entries(&path, relative_path, &mut files, &mut directories)?;
        }

        let mut remote_targets = HashSet::new();
        for directory in &directories {
            validate_relative_remote_path(directory)?;
            if !remote_targets.insert(directory.as_str()) {
                return Err(format!("拖入的项目存在重复远程路径: {}", directory));
            }
        }
        for (_, relative_path) in &files {
            validate_relative_remote_path(relative_path)?;
            if !remote_targets.insert(relative_path.as_str()) {
                return Err(format!("拖入的项目存在重复远程路径: {}", relative_path));
            }
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

        if !overwrite {
            let conflicts: Vec<&str> = files
                .iter()
                .filter_map(|(_, relative_path)| {
                    let target_path = remote_join(parent_path.trim_end_matches('/'), relative_path);
                    sftp.stat(Path::new(&target_path))
                        .is_ok()
                        .then_some(relative_path.as_str())
                })
                .collect();
            if !conflicts.is_empty() {
                return Err(format!("SFTP_FILES_EXIST:{}", conflicts.join("\n")));
            }
        }

        directories.sort();
        directories.dedup();
        for directory in &directories {
            ensure_remote_directory(&sftp, &parent_path, directory)?;
        }

        for (local_path, relative_path) in &files {
            let target_path = remote_join(parent_path.trim_end_matches('/'), relative_path);
            let mut local_file = fs::File::open(local_path).map_err(|error| {
                format!("打开本地文件 '{}' 失败: {}", local_path.display(), error)
            })?;
            let mut remote_file = sftp
                .open_mode(
                    Path::new(&target_path),
                    OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
                    0o644,
                    OpenType::File,
                )
                .map_err(|error| format!("打开远程文件 '{}' 失败: {}", target_path, error))?;
            std::io::copy(&mut local_file, &mut remote_file)
                .and_then(|_| remote_file.flush())
                .map_err(|error| format!("上传远程文件 '{}' 失败: {}", target_path, error))?;
        }

        Ok(SftpUploadBatchResult {
            uploaded: files.len(),
            directories: directories.len(),
        })
    })
    .await
    .map_err(|error| format!("SFTP 本地路径上传任务异常: {}", error))?
}

#[tauri::command]
async fn download_sftp_file(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: String,
    path: String,
) -> Result<SftpDownloadResult, String> {
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
        let remote_path = Path::new(path.trim());
        let stat = sftp
            .stat(remote_path)
            .map_err(|error| format!("读取远程文件信息失败: {}", error))?;
        if stat.is_dir() {
            return Err("不能将目录作为单个文件下载".to_string());
        }
        if stat.size.unwrap_or(0) > MAX_SFTP_TRANSFER_BYTES as u64 {
            return Err(format!(
                "单个下载文件不能超过 {} MB",
                MAX_SFTP_TRANSFER_BYTES / 1024 / 1024
            ));
        }

        let name = remote_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "无法识别远程文件名称".to_string())?
            .to_string();
        let remote_file = sftp
            .open(remote_path)
            .map_err(|error| format!("打开远程文件 '{}' 失败: {}", path.trim(), error))?;
        let mut content = Vec::with_capacity(stat.size.unwrap_or(0) as usize);
        remote_file
            .take((MAX_SFTP_TRANSFER_BYTES + 1) as u64)
            .read_to_end(&mut content)
            .map_err(|error| format!("下载远程文件 '{}' 失败: {}", path.trim(), error))?;
        if content.len() > MAX_SFTP_TRANSFER_BYTES {
            return Err(format!(
                "下载内容超过 {} MB 限制",
                MAX_SFTP_TRANSFER_BYTES / 1024 / 1024
            ));
        }

        Ok(SftpDownloadResult { name, content })
    })
    .await
    .map_err(|error| format!("SFTP 下载任务异常: {}", error))?
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            test_ssh_connection,
            execute_ssh_command,
            complete_ssh_input,
            list_sftp_directory,
            create_sftp_directory,
            create_sftp_directory_tree,
            upload_sftp_file,
            upload_sftp_local_paths,
            download_sftp_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
