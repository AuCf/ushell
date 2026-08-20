// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod monitoring;
mod secure_store;

use ssh2::{HashType, HostKeyType, OpenFlags, OpenType, RenameFlags, Session, Sftp};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static TEMP_KEY_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static TERMINAL_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static SFTP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const SFTP_TRANSFER_BUFFER_BYTES: usize = 128 * 1024;
const SSH_CONNECT_PHASE_TIMEOUT_MS: u32 = 15_000;
const SSH_SESSION_TIMEOUT_MS: u32 = 180_000;
const SSH_KEEPALIVE_INTERVAL_SECS: u32 = 30;

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
struct RuntimePlatform {
    os: &'static str,
    arch: &'static str,
}

#[tauri::command]
fn get_runtime_platform() -> RuntimePlatform {
    RuntimePlatform {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

#[derive(serde::Serialize)]
struct SftpUploadBatchResult {
    uploaded: usize,
    directories: usize,
}

#[derive(Clone)]
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
            Ok(stream) => return Ok(stream),
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
    session.set_timeout(SSH_CONNECT_PHASE_TIMEOUT_MS);
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|error| format!("SSH 握手失败: {}", error))?;
    verify_host_key(&session, &credentials.host, credentials.port)?;

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

    session.set_keepalive(true, SSH_KEEPALIVE_INTERVAL_SECS);
    session.set_timeout(SSH_SESSION_TIMEOUT_MS);
    Ok(session)
}

fn host_key_identity(session: &Session) -> Result<(HostKeyType, String), String> {
    let (_, key_type) = session
        .host_key()
        .ok_or_else(|| "SSH 服务器未提供主机密钥".to_string())?;
    let fingerprint = session
        .host_key_hash(HashType::Sha256)
        .ok_or_else(|| "无法计算 SSH 主机 SHA-256 指纹".to_string())?
        .iter()
        .map(|value| format!("{:02X}", value))
        .collect::<Vec<_>>()
        .join(":");
    Ok((key_type, fingerprint))
}

fn verify_host_key(session: &Session, host: &str, port: u16) -> Result<(), String> {
    let (key_type, fingerprint) = host_key_identity(session)?;
    let observed = format!("{:?}|{}", key_type, fingerprint);
    let account = secure_store::host_key_account(host, port);
    match secure_store::get_secret(&account)? {
        Some(expected) if expected == observed => {
            let _ = secure_store::index_trusted_host(secure_store::TrustedHostKey {
                host: host.trim().to_string(),
                port,
                algorithm: format!("{:?}", key_type),
                fingerprint,
            });
            Ok(())
        }
        Some(expected) => Err(format!(
            "SSH_HOST_KEY_MISMATCH|{}|{}|{}|{}|{}",
            host.trim(),
            port,
            format!("{:?}", key_type),
            fingerprint,
            expected.replace('|', ":")
        )),
        None => Err(format!(
            "SSH_HOST_KEY_UNKNOWN|{}|{}|{}|{}",
            host.trim(),
            port,
            format!("{:?}", key_type),
            fingerprint
        )),
    }
}

#[tauri::command]
async fn trust_ssh_host_key(
    host: String,
    port: u16,
    expected_fingerprint: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let tcp = connect_tcp(&host, port)?;
        let mut session =
            Session::new().map_err(|error| format!("创建 SSH 会话失败: {}", error))?;
        session.set_timeout(SSH_CONNECT_PHASE_TIMEOUT_MS);
        session.set_tcp_stream(tcp);
        session
            .handshake()
            .map_err(|error| format!("SSH 握手失败: {}", error))?;
        let (key_type, fingerprint) = host_key_identity(&session)?;
        if fingerprint != expected_fingerprint {
            return Err("服务器主机指纹在确认期间发生变化，已拒绝信任".to_string());
        }
        secure_store::remember_trusted_host(secure_store::TrustedHostKey {
            host,
            port,
            algorithm: format!("{:?}", key_type),
            fingerprint,
        })
    })
    .await
    .map_err(|error| format!("保存 SSH 主机信任任务异常: {}", error))?
}

fn send_terminal_keepalive(session: &Session) -> Result<u32, String> {
    session.set_timeout(SSH_CONNECT_PHASE_TIMEOUT_MS);
    session.set_blocking(true);
    let result = session.keepalive_send();
    session.set_blocking(false);
    session.set_timeout(SSH_SESSION_TIMEOUT_MS);
    result.map_err(|error| format!("SSH keepalive 失败: {}", error))
}

fn run_terminal_session(
    credentials: SshCredentials,
    cols: u32,
    rows: u32,
    receiver: mpsc::Receiver<TerminalCommand>,
    on_event: tauri::ipc::Channel<TerminalEvent>,
) -> Result<Option<i32>, String> {
    let started_at = Instant::now();
    let session = connect_and_authenticate(&credentials)?;
    let banner = session.banner().unwrap_or("SSH-2.0").trim().to_string();
    let mut channel = session
        .channel_session()
        .map_err(|error| format!("创建 SSH 终端通道失败: {}", error))?;
    channel
        .request_pty(
            "xterm-256color",
            None,
            Some((cols.clamp(1, 1000), rows.clamp(1, 1000), 0, 0)),
        )
        .map_err(|error| format!("申请远程 PTY 失败: {}", error))?;
    channel
        .shell()
        .map_err(|error| format!("启动远程交互式 Shell 失败: {}", error))?;
    on_event
        .send(TerminalEvent::Connected {
            banner,
            latency_ms: started_at.elapsed().as_millis(),
        })
        .map_err(|error| format!("发送终端连接事件失败: {}", error))?;

    session.set_blocking(false);
    let mut output_buffer = [0_u8; 32 * 1024];
    let mut next_keepalive_at =
        Instant::now() + Duration::from_secs(u64::from(SSH_KEEPALIVE_INTERVAL_SECS));
    loop {
        for _ in 0..64 {
            match receiver.try_recv() {
                Ok(TerminalCommand::Input(data)) => {
                    if data.is_empty() {
                        continue;
                    }
                    session.set_blocking(true);
                    let write_result = channel.write_all(&data).and_then(|_| channel.flush());
                    session.set_blocking(false);
                    write_result.map_err(|error| format!("发送终端输入失败: {}", error))?;
                }
                Ok(TerminalCommand::Resize { cols, rows }) => {
                    session.set_blocking(true);
                    let resize_result = channel.request_pty_size(
                        cols.clamp(1, 1000),
                        rows.clamp(1, 1000),
                        None,
                        None,
                    );
                    session.set_blocking(false);
                    resize_result.map_err(|error| format!("调整远程 PTY 尺寸失败: {}", error))?;
                }
                Ok(TerminalCommand::Close) | Err(mpsc::TryRecvError::Disconnected) => {
                    session.set_blocking(true);
                    let _ = channel.send_eof();
                    let _ = channel.close();
                    return Ok(None);
                }
                Err(mpsc::TryRecvError::Empty) => break,
            }
        }

        let mut received_output = false;
        loop {
            match channel.read(&mut output_buffer) {
                Ok(0) => break,
                Ok(read_count) => {
                    received_output = true;
                    on_event
                        .send(TerminalEvent::Output {
                            data: output_buffer[..read_count].to_vec(),
                        })
                        .map_err(|error| format!("发送终端输出事件失败: {}", error))?;
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    break;
                }
                Err(error) => return Err(format!("读取远程终端输出失败: {}", error)),
            }
        }

        if channel.eof() {
            session.set_blocking(true);
            let _ = channel.wait_close();
            return channel
                .exit_status()
                .map(Some)
                .map_err(|error| format!("读取远程 Shell 退出状态失败: {}", error));
        }
        if Instant::now() >= next_keepalive_at {
            let wait_seconds = send_terminal_keepalive(&session)?;
            next_keepalive_at =
                Instant::now() + Duration::from_secs(u64::from(wait_seconds.max(1)));
        }
        if !received_output {
            thread::sleep(Duration::from_millis(8));
        }
    }
}

#[tauri::command]
fn open_ssh_terminal(
    state: tauri::State<'_, TerminalRegistry>,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: String,
    cols: u32,
    rows: u32,
    on_event: tauri::ipc::Channel<TerminalEvent>,
) -> Result<String, String> {
    let session_id = format!(
        "terminal-{}-{}",
        std::process::id(),
        TERMINAL_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let credentials = SshCredentials {
        host,
        port,
        username,
        password,
        private_key,
        auth_type,
    };
    let (sender, receiver) = mpsc::channel();
    state
        .0
        .lock()
        .map_err(|_| "终端会话注册表已损坏".to_string())?
        .insert(session_id.clone(), sender);

    let registry = state.inner().clone();
    let thread_registry = registry.clone();
    let thread_session_id = session_id.clone();
    let spawn_result = thread::Builder::new()
        .name(format!("ssh-pty-{}", session_id))
        .spawn(move || {
            let result = run_terminal_session(credentials, cols, rows, receiver, on_event.clone());
            match result {
                Ok(exit_status) => {
                    let _ = on_event.send(TerminalEvent::Closed { exit_status });
                }
                Err(message) => {
                    let _ = on_event.send(TerminalEvent::Error {
                        message: message.clone(),
                    });
                    let _ = on_event.send(TerminalEvent::Closed { exit_status: None });
                }
            }
            if let Ok(mut sessions) = thread_registry.0.lock() {
                sessions.remove(&thread_session_id);
            }
        });

    if let Err(error) = spawn_result {
        if let Ok(mut sessions) = registry.0.lock() {
            sessions.remove(&session_id);
        }
        return Err(format!("启动 SSH 终端线程失败: {}", error));
    }
    Ok(session_id)
}

fn terminal_sender(
    state: &tauri::State<'_, TerminalRegistry>,
    session_id: &str,
) -> Result<mpsc::Sender<TerminalCommand>, String> {
    state
        .0
        .lock()
        .map_err(|_| "终端会话注册表已损坏".to_string())?
        .get(session_id)
        .cloned()
        .ok_or_else(|| "终端会话不存在或已经关闭".to_string())
}

#[tauri::command]
fn write_ssh_terminal(
    state: tauri::State<'_, TerminalRegistry>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    terminal_sender(&state, &session_id)?
        .send(TerminalCommand::Input(data.into_bytes()))
        .map_err(|_| "终端会话已经断开".to_string())
}

#[tauri::command]
fn resize_ssh_terminal(
    state: tauri::State<'_, TerminalRegistry>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    terminal_sender(&state, &session_id)?
        .send(TerminalCommand::Resize { cols, rows })
        .map_err(|_| "终端会话已经断开".to_string())
}

#[tauri::command]
fn close_ssh_terminal(
    state: tauri::State<'_, TerminalRegistry>,
    session_id: String,
) -> Result<(), String> {
    let sender = state
        .0
        .lock()
        .map_err(|_| "终端会话注册表已损坏".to_string())?
        .remove(&session_id);
    if let Some(sender) = sender {
        let _ = sender.send(TerminalCommand::Close);
    }
    Ok(())
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

fn validate_remote_operation_path(path: &str) -> Result<&str, String> {
    let path = path.trim().trim_end_matches('/');
    let contains_navigation = path
        .split('/')
        .any(|component| matches!(component, "." | ".."));
    let is_windows_root = path.len() == 2 && path.ends_with(':');
    if path.is_empty() || path == "~" || contains_navigation || is_windows_root {
        return Err("禁止对远程根目录或未明确的路径执行此操作".to_string());
    }
    Ok(path)
}

fn remove_sftp_path_recursive(sftp: &ssh2::Sftp, path: &Path) -> Result<(), String> {
    let stat = sftp
        .lstat(path)
        .map_err(|error| format!("读取远程路径 '{}' 失败: {}", path.display(), error))?;
    if !stat.is_dir() {
        return sftp
            .unlink(path)
            .map_err(|error| format!("删除远程文件 '{}' 失败: {}", path.display(), error));
    }

    let children = sftp
        .readdir(path)
        .map_err(|error| format!("读取远程目录 '{}' 失败: {}", path.display(), error))?;
    for (child_path, _) in children {
        remove_sftp_path_recursive(sftp, &child_path)?;
    }
    sftp.rmdir(path)
        .map_err(|error| format!("删除远程目录 '{}' 失败: {}", path.display(), error))
}

#[derive(Clone, Default)]
struct TerminalRegistry(Arc<Mutex<HashMap<String, mpsc::Sender<TerminalCommand>>>>);

struct SftpConnection {
    credentials: SshCredentials,
    session: Session,
    sftp: Sftp,
}

#[derive(Clone, Default)]
struct SftpRegistry(Arc<Mutex<HashMap<String, Arc<Mutex<SftpConnection>>>>>);

#[derive(Clone)]
struct TransferTask {
    session_id: String,
    cancelled: Arc<AtomicBool>,
}

#[derive(Clone, Default)]
struct TransferRegistry(Arc<Mutex<HashMap<String, TransferTask>>>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SftpTransferEvent {
    transferred: u64,
    total: u64,
    file_name: String,
}

fn start_transfer(
    registry: &TransferRegistry,
    session_id: &str,
    task_id: &str,
) -> Result<Arc<AtomicBool>, String> {
    if task_id.trim().is_empty() {
        return Err("SFTP 传输任务标识不能为空".to_string());
    }
    let mut tasks = registry
        .0
        .lock()
        .map_err(|_| "SFTP 传输任务注册表已损坏".to_string())?;
    if tasks.contains_key(task_id) {
        return Err("SFTP 传输任务已经存在".to_string());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    tasks.insert(
        task_id.to_string(),
        TransferTask {
            session_id: session_id.to_string(),
            cancelled: cancelled.clone(),
        },
    );
    Ok(cancelled)
}

fn finish_transfer(registry: &TransferRegistry, task_id: &str) {
    if let Ok(mut tasks) = registry.0.lock() {
        tasks.remove(task_id);
    }
}

fn cancel_sftp_session_transfers(registry: &TransferRegistry, session_id: &str) {
    if let Ok(tasks) = registry.0.lock() {
        for task in tasks.values().filter(|task| task.session_id == session_id) {
            task.cancelled.store(true, Ordering::Relaxed);
        }
    }
}

fn copy_with_transfer_progress<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    transferred: &mut u64,
    total: u64,
    file_name: &str,
    cancelled: &AtomicBool,
    on_event: &tauri::ipc::Channel<SftpTransferEvent>,
) -> Result<(), String> {
    let mut buffer = vec![0_u8; SFTP_TRANSFER_BUFFER_BYTES];
    let mut last_update = Instant::now();
    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err("SFTP_TRANSFER_CANCELLED".to_string());
        }
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("读取传输数据失败: {}", error))?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|error| format!("写入传输数据失败: {}", error))?;
        *transferred += read as u64;
        if last_update.elapsed() >= Duration::from_millis(120)
            || (total > 0 && *transferred >= total)
        {
            let _ = on_event.send(SftpTransferEvent {
                transferred: *transferred,
                total,
                file_name: file_name.to_string(),
            });
            last_update = Instant::now();
        }
    }
    writer
        .flush()
        .map_err(|error| format!("刷新传输文件失败: {}", error))?;
    let _ = on_event.send(SftpTransferEvent {
        transferred: *transferred,
        total,
        file_name: file_name.to_string(),
    });
    Ok(())
}

#[tauri::command]
fn cancel_sftp_transfer(
    state: tauri::State<'_, TransferRegistry>,
    task_id: String,
) -> Result<(), String> {
    let tasks = state
        .inner()
        .0
        .lock()
        .map_err(|_| "SFTP 传输任务注册表已损坏".to_string())?;
    if let Some(task) = tasks.get(&task_id) {
        task.cancelled.store(true, Ordering::Relaxed);
    }
    Ok(())
}

enum TerminalCommand {
    Input(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

#[derive(serde::Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum TerminalEvent {
    Connected {
        banner: String,
        #[serde(rename = "latencyMs")]
        latency_ms: u128,
    },
    Output {
        data: Vec<u8>,
    },
    Error {
        message: String,
    },
    Closed {
        #[serde(rename = "exitStatus")]
        exit_status: Option<i32>,
    },
}

fn create_sftp_connection(credentials: SshCredentials) -> Result<SftpConnection, String> {
    let session = connect_and_authenticate(&credentials)?;
    let sftp = session
        .sftp()
        .map_err(|error| format!("初始化 SFTP 会话失败: {}", error))?;
    Ok(SftpConnection {
        credentials,
        session,
        sftp,
    })
}

fn reconnect_sftp(connection: &mut SftpConnection) -> Result<(), String> {
    *connection = create_sftp_connection(connection.credentials.clone())?;
    Ok(())
}

fn prepare_sftp_connection(connection: &mut SftpConnection) -> Result<(), String> {
    connection.session.set_timeout(SSH_CONNECT_PHASE_TIMEOUT_MS);
    let keepalive_result = connection.session.keepalive_send();
    connection.session.set_timeout(SSH_SESSION_TIMEOUT_MS);
    if keepalive_result.is_err() {
        reconnect_sftp(connection)?;
    }
    Ok(())
}

fn start_sftp_keepalive(
    session_id: &str,
    connection: &Arc<Mutex<SftpConnection>>,
) -> Result<(), String> {
    let weak_connection = Arc::downgrade(connection);
    thread::Builder::new()
        .name(format!("sftp-keepalive-{}", session_id))
        .spawn(move || loop {
            thread::sleep(Duration::from_secs(15));
            let Some(connection) = weak_connection.upgrade() else {
                break;
            };
            let Ok(mut connection) = connection.lock() else {
                break;
            };
            let _ = prepare_sftp_connection(&mut connection);
        })
        .map(|_| ())
        .map_err(|error| format!("启动 SFTP 保活线程失败: {}", error))
}

fn is_sftp_transport_error(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    [
        "transport",
        "socket",
        "connection reset",
        "connection aborted",
        "broken pipe",
        "timed out",
        "timeout",
        "session closed",
        "channel closed",
    ]
    .iter()
    .any(|candidate| message.contains(candidate))
}

fn with_sftp_connection<T, F>(
    registry: &SftpRegistry,
    session_id: &str,
    retry_safe: bool,
    mut operation: F,
) -> Result<T, String>
where
    F: FnMut(&mut SftpConnection) -> Result<T, String>,
{
    let registered = registry
        .0
        .lock()
        .map_err(|_| "SFTP 会话注册表已损坏".to_string())?
        .get(session_id)
        .cloned()
        .ok_or_else(|| "SFTP 会话不存在或已经关闭".to_string())?;
    let mut connection = registered
        .lock()
        .map_err(|_| "SFTP 会话状态已损坏".to_string())?;

    prepare_sftp_connection(&mut connection)?;
    match operation(&mut connection) {
        Ok(result) => Ok(result),
        Err(first_error) if is_sftp_transport_error(&first_error) => {
            reconnect_sftp(&mut connection).map_err(|reconnect_error| {
                format!(
                    "{}；重新建立 SFTP 连接失败: {}",
                    first_error, reconnect_error
                )
            })?;
            if retry_safe {
                operation(&mut connection)
            } else {
                Err(first_error)
            }
        }
        Err(error) => Err(error),
    }
}

fn sftp_credentials_for_session(
    registry: &SftpRegistry,
    session_id: &str,
) -> Result<SshCredentials, String> {
    let registered = registry
        .0
        .lock()
        .map_err(|_| "SFTP 会话注册表已损坏".to_string())?
        .get(session_id)
        .cloned()
        .ok_or_else(|| "SFTP 会话不存在或已经关闭".to_string())?;
    let connection = registered
        .lock()
        .map_err(|_| "SFTP 会话状态已损坏".to_string())?;
    Ok(connection.credentials.clone())
}

fn open_remote_upload_temp(sftp: &Sftp, target_path: &str) -> Result<(String, ssh2::File), String> {
    let temp_path = format!(
        "{}.ushell-part-{}-{}",
        target_path,
        std::process::id(),
        SFTP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let file = sftp
        .open_mode(
            Path::new(&temp_path),
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUSIVE,
            0o644,
            OpenType::File,
        )
        .map_err(|error| format!("创建远程临时文件 '{}' 失败: {}", temp_path, error))?;
    Ok((temp_path, file))
}

fn commit_remote_upload(
    sftp: &Sftp,
    temp_path: &str,
    target_path: &str,
    relative_path: &str,
    overwrite: bool,
) -> Result<(), String> {
    let flags = if overwrite {
        RenameFlags::ATOMIC | RenameFlags::OVERWRITE | RenameFlags::NATIVE
    } else {
        RenameFlags::ATOMIC | RenameFlags::NATIVE
    };
    if let Err(error) = sftp.rename(Path::new(temp_path), Path::new(target_path), Some(flags)) {
        let _ = sftp.unlink(Path::new(temp_path));
        if !overwrite && sftp.stat(Path::new(target_path)).is_ok() {
            return Err(format!("SFTP_FILE_EXISTS:{}", relative_path));
        }
        return Err(format!(
            "提交远程文件 '{}' 失败，原文件未被修改: {}",
            target_path, error
        ));
    }
    Ok(())
}

fn local_sidecar_path(target_path: &Path, marker: &str, task_id: &str) -> PathBuf {
    PathBuf::from(format!(
        "{}.ushell-{}-{}",
        target_path.display(),
        marker,
        task_id
    ))
}

fn finalize_local_download(
    part_path: &Path,
    target_path: &Path,
    task_id: &str,
) -> Result<(), String> {
    if !target_path.exists() {
        return fs::rename(part_path, target_path)
            .map_err(|error| format!("完成本地文件保存失败: {}", error));
    }

    let backup_path = local_sidecar_path(target_path, "backup", task_id);
    fs::rename(target_path, &backup_path).map_err(|error| {
        format!(
            "准备替换本地文件 '{}' 失败，原文件未被修改: {}",
            target_path.display(),
            error
        )
    })?;

    if let Err(error) = fs::rename(part_path, target_path) {
        let rollback = fs::rename(&backup_path, target_path);
        return Err(match rollback {
            Ok(()) => format!("完成本地文件保存失败，已恢复原文件: {}", error),
            Err(rollback_error) => format!(
                "完成本地文件保存失败，原文件保留在 '{}': {}；恢复失败: {}",
                backup_path.display(),
                error,
                rollback_error
            ),
        });
    }

    let _ = fs::remove_file(&backup_path);
    Ok(())
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
    cancelled: &AtomicBool,
) -> Result<(), String> {
    if cancelled.load(Ordering::Relaxed) {
        return Err("SFTP_TRANSFER_CANCELLED".to_string());
    }
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
            cancelled,
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
async fn get_server_metrics(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: String,
) -> Result<monitoring::ServerMetrics, String> {
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
        monitoring::collect(&session)
    })
    .await
    .map_err(|error| format!("服务器监控任务异常: {}", error))?
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
async fn open_sftp_session(
    state: tauri::State<'_, SftpRegistry>,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    auth_type: String,
) -> Result<String, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let credentials = SshCredentials {
            host,
            port,
            username,
            password,
            private_key,
            auth_type,
        };
        let connection = Arc::new(Mutex::new(create_sftp_connection(credentials)?));
        let session_id = format!(
            "sftp-{}-{}",
            std::process::id(),
            SFTP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        start_sftp_keepalive(&session_id, &connection)?;
        registry
            .0
            .lock()
            .map_err(|_| "SFTP 会话注册表已损坏".to_string())?
            .insert(session_id.clone(), connection);
        Ok(session_id)
    })
    .await
    .map_err(|error| format!("打开 SFTP 会话任务异常: {}", error))?
}

#[tauri::command]
fn close_sftp_session(
    state: tauri::State<'_, SftpRegistry>,
    transfer_state: tauri::State<'_, TransferRegistry>,
    session_id: String,
) -> Result<(), String> {
    cancel_sftp_session_transfers(transfer_state.inner(), &session_id);
    state
        .0
        .lock()
        .map_err(|_| "SFTP 会话注册表已损坏".to_string())?
        .remove(&session_id);
    Ok(())
}

#[tauri::command]
async fn list_sftp_directory(
    state: tauri::State<'_, SftpRegistry>,
    session_id: String,
    path: String,
) -> Result<SftpDirectoryResult, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        with_sftp_connection(&registry, &session_id, true, |connection| {
            let sftp = &connection.sftp;
            let requested_path = if path.trim().is_empty() {
                "."
            } else {
                path.trim()
            };
            let resolved_path = if requested_path.starts_with('/') {
                requested_path.trim_end_matches('/').to_string()
            } else {
                sftp.realpath(Path::new(requested_path))
                    .map_err(|error| format!("无法访问远程目录 '{}': {}", requested_path, error))?
                    .to_string_lossy()
                    .replace('\\', "/")
            };
            let resolved_path = if resolved_path.is_empty() {
                "/".to_string()
            } else {
                resolved_path
            };
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
    })
    .await
    .map_err(|error| format!("SFTP 目录任务异常: {}", error))?
}

#[tauri::command]
async fn create_sftp_directory(
    state: tauri::State<'_, SftpRegistry>,
    session_id: String,
    parent_path: String,
    folder_name: String,
) -> Result<(), String> {
    let registry = state.inner().clone();
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

        with_sftp_connection(&registry, &session_id, false, |connection| {
            let target_path = remote_join(parent_path.trim_end_matches('/'), folder_name);
            connection
                .sftp
                .mkdir(Path::new(&target_path), 0o755)
                .map_err(|error| format!("创建远程目录 '{}' 失败: {}", target_path, error))
        })
    })
    .await
    .map_err(|error| format!("SFTP 新建目录任务异常: {}", error))?
}

#[tauri::command]
async fn upload_sftp_local_paths(
    state: tauri::State<'_, SftpRegistry>,
    transfer_state: tauri::State<'_, TransferRegistry>,
    session_id: String,
    task_id: String,
    parent_path: String,
    local_paths: Vec<String>,
    overwrite: bool,
    on_event: tauri::ipc::Channel<SftpTransferEvent>,
) -> Result<SftpUploadBatchResult, String> {
    let registry = state.inner().clone();
    let transfers = transfer_state.inner().clone();
    let credentials = sftp_credentials_for_session(&registry, &session_id)?;
    let cancelled = start_transfer(&transfers, &session_id, &task_id)?;
    let task_id_for_cleanup = task_id.clone();
    let join_result = tauri::async_runtime::spawn_blocking(move || {
        if local_paths.is_empty() {
            return Err("没有收到需要上传的本地文件或目录".to_string());
        }

        let mut files = Vec::new();
        let mut directories = Vec::new();
        for local_path in local_paths {
            let path = PathBuf::from(local_path);
            let relative_path = local_file_name(&path)?;
            validate_relative_remote_path(&relative_path)?;
            collect_local_upload_entries(
                &path,
                relative_path,
                &mut files,
                &mut directories,
                &cancelled,
            )?;
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

        let total = files.iter().try_fold(0_u64, |sum, (path, _)| {
            fs::metadata(path)
                .map(|metadata| sum.saturating_add(metadata.len()))
                .map_err(|error| format!("读取本地文件大小 '{}' 失败: {}", path.display(), error))
        })?;

        let connection = create_sftp_connection(credentials)?;
        let sftp = &connection.sftp;
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
            if cancelled.load(Ordering::Relaxed) {
                return Err("SFTP_TRANSFER_CANCELLED".to_string());
            }
            ensure_remote_directory(sftp, &parent_path, directory)?;
        }

        let mut transferred = 0_u64;
        for (local_path, relative_path) in &files {
            if cancelled.load(Ordering::Relaxed) {
                return Err("SFTP_TRANSFER_CANCELLED".to_string());
            }
            let target_path = remote_join(parent_path.trim_end_matches('/'), relative_path);
            let mut local_file = fs::File::open(local_path).map_err(|error| {
                format!("打开本地文件 '{}' 失败: {}", local_path.display(), error)
            })?;
            let (temp_path, mut remote_file) = open_remote_upload_temp(sftp, &target_path)?;
            let copy_result = copy_with_transfer_progress(
                &mut local_file,
                &mut remote_file,
                &mut transferred,
                total,
                relative_path,
                &cancelled,
                &on_event,
            );
            drop(remote_file);
            if let Err(error) = copy_result {
                let _ = sftp.unlink(Path::new(&temp_path));
                if error == "SFTP_TRANSFER_CANCELLED" {
                    return Err(error);
                }
                return Err(format!("上传远程文件 '{}' 失败: {}", target_path, error));
            }
            commit_remote_upload(sftp, &temp_path, &target_path, relative_path, overwrite)?;
        }

        Ok(SftpUploadBatchResult {
            uploaded: files.len(),
            directories: directories.len(),
        })
    })
    .await;
    finish_transfer(&transfers, &task_id_for_cleanup);
    join_result.map_err(|error| format!("SFTP 本地路径上传任务异常: {}", error))?
}

#[tauri::command]
async fn delete_sftp_path(
    state: tauri::State<'_, SftpRegistry>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let remote_path = validate_remote_operation_path(&path)?;
        with_sftp_connection(&registry, &session_id, false, |connection| {
            remove_sftp_path_recursive(&connection.sftp, Path::new(remote_path))
        })
    })
    .await
    .map_err(|error| format!("SFTP 删除任务异常: {}", error))?
}

#[tauri::command]
async fn download_sftp_directory(
    state: tauri::State<'_, SftpRegistry>,
    transfer_state: tauri::State<'_, TransferRegistry>,
    session_id: String,
    task_id: String,
    path: String,
    local_path: String,
    on_event: tauri::ipc::Channel<SftpTransferEvent>,
) -> Result<(), String> {
    let registry = state.inner().clone();
    let transfers = transfer_state.inner().clone();
    let credentials = sftp_credentials_for_session(&registry, &session_id)?;
    let cancelled = start_transfer(&transfers, &session_id, &task_id)?;
    let task_id_for_cleanup = task_id.clone();
    let join_result = tauri::async_runtime::spawn_blocking(move || {
        let remote_path = validate_remote_operation_path(&path)?;
        let (parent_path, directory_name) = remote_path
            .rsplit_once('/')
            .map(|(parent, name)| (if parent.is_empty() { "/" } else { parent }, name))
            .unwrap_or((".", remote_path));
        if directory_name.is_empty() {
            return Err("无法识别需要下载的远程目录名称".to_string());
        }
        let target_path = PathBuf::from(local_path.trim());
        if target_path.as_os_str().is_empty() {
            return Err("本地保存路径不能为空".to_string());
        }
        let part_path = PathBuf::from(format!("{}.ushell-part-{}", target_path.display(), task_id));

        let transfer_result = (|| {
            let connection = create_sftp_connection(credentials)?;
            let mut channel = connection
                .session
                .channel_session()
                .map_err(|error| format!("创建目录归档通道失败: {}", error))?;
            let command = format!(
                "cd -- {} && tar -czf - -- {}",
                shell_quote(parent_path),
                shell_quote(directory_name)
            );
            channel
                .exec(&command)
                .map_err(|error| format!("启动远程目录归档失败: {}", error))?;

            let mut local_file = fs::File::create(&part_path).map_err(|error| {
                format!("创建本地文件 '{}' 失败: {}", part_path.display(), error)
            })?;
            let mut transferred = 0_u64;
            copy_with_transfer_progress(
                &mut channel,
                &mut local_file,
                &mut transferred,
                0,
                directory_name,
                &cancelled,
                &on_event,
            )?;

            let mut stderr = String::new();
            channel
                .stderr()
                .read_to_string(&mut stderr)
                .map_err(|error| format!("读取远程目录归档错误失败: {}", error))?;
            channel
                .wait_close()
                .map_err(|error| format!("关闭目录归档通道失败: {}", error))?;
            let exit_status = channel
                .exit_status()
                .map_err(|error| format!("读取目录归档状态失败: {}", error))?;
            if exit_status != 0 {
                return Err(format!(
                    "远程目录打包失败，请确认服务器已安装 tar: {}",
                    stderr.trim()
                ));
            }

            Ok(())
        })();
        if let Err(error) = transfer_result {
            let _ = fs::remove_file(&part_path);
            return Err(error);
        }
        finalize_local_download(&part_path, &target_path, &task_id)
    })
    .await;
    finish_transfer(&transfers, &task_id_for_cleanup);
    join_result.map_err(|error| format!("SFTP 目录下载任务异常: {}", error))?
}

#[tauri::command]
async fn download_sftp_file(
    state: tauri::State<'_, SftpRegistry>,
    transfer_state: tauri::State<'_, TransferRegistry>,
    session_id: String,
    task_id: String,
    path: String,
    local_path: String,
    on_event: tauri::ipc::Channel<SftpTransferEvent>,
) -> Result<(), String> {
    let registry = state.inner().clone();
    let transfers = transfer_state.inner().clone();
    let credentials = sftp_credentials_for_session(&registry, &session_id)?;
    let cancelled = start_transfer(&transfers, &session_id, &task_id)?;
    let task_id_for_cleanup = task_id.clone();
    let join_result = tauri::async_runtime::spawn_blocking(move || {
        let target_path = PathBuf::from(local_path.trim());
        if target_path.as_os_str().is_empty() {
            return Err("本地保存路径不能为空".to_string());
        }
        let part_path = PathBuf::from(format!("{}.ushell-part-{}", target_path.display(), task_id));
        let transfer_result = (|| {
            let connection = create_sftp_connection(credentials)?;
            let sftp = &connection.sftp;
            let remote_path = Path::new(path.trim());
            let stat = sftp
                .stat(remote_path)
                .map_err(|error| format!("读取远程文件信息失败: {}", error))?;
            if stat.is_dir() {
                return Err("不能将目录作为单个文件下载".to_string());
            }
            let name = remote_path
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "无法识别远程文件名称".to_string())?
                .to_string();
            let mut remote_file = sftp
                .open(remote_path)
                .map_err(|error| format!("打开远程文件 '{}' 失败: {}", path.trim(), error))?;
            let mut local_file = fs::File::create(&part_path).map_err(|error| {
                format!("创建本地文件 '{}' 失败: {}", part_path.display(), error)
            })?;
            let mut transferred = 0_u64;
            copy_with_transfer_progress(
                &mut remote_file,
                &mut local_file,
                &mut transferred,
                stat.size.unwrap_or(0),
                &name,
                &cancelled,
                &on_event,
            )
        })();
        if let Err(error) = transfer_result {
            let _ = fs::remove_file(&part_path);
            return Err(error);
        }
        finalize_local_download(&part_path, &target_path, &task_id)
    })
    .await;
    finish_transfer(&transfers, &task_id_for_cleanup);
    join_result.map_err(|error| format!("SFTP 下载任务异常: {}", error))?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(TerminalRegistry::default())
        .manage(SftpRegistry::default())
        .manage(TransferRegistry::default())
        .invoke_handler(tauri::generate_handler![
            test_ssh_connection,
            get_runtime_platform,
            get_server_metrics,
            execute_ssh_command,
            complete_ssh_input,
            trust_ssh_host_key,
            open_ssh_terminal,
            write_ssh_terminal,
            resize_ssh_terminal,
            close_ssh_terminal,
            open_sftp_session,
            close_sftp_session,
            list_sftp_directory,
            create_sftp_directory,
            upload_sftp_local_paths,
            cancel_sftp_transfer,
            delete_sftp_path,
            download_sftp_directory,
            download_sftp_file,
            secure_store::save_server_secret,
            secure_store::load_server_secret,
            secure_store::delete_server_secret,
            secure_store::save_ai_api_key,
            secure_store::load_ai_api_key,
            secure_store::list_trusted_hosts,
            secure_store::delete_trusted_host
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        finalize_local_download, is_sftp_transport_error, local_sidecar_path, remote_join,
        validate_relative_remote_path, SFTP_SEQUENCE,
    };
    use std::fs;
    use std::sync::atomic::Ordering;

    #[test]
    fn joins_remote_paths_without_duplicate_separators() {
        assert_eq!(remote_join("/var/www/", "app"), "/var/www/app");
        assert_eq!(remote_join("/", "app"), "/app");
    }

    #[test]
    fn rejects_unsafe_relative_upload_paths() {
        assert!(validate_relative_remote_path("../secret").is_err());
        assert!(validate_relative_remote_path("folder//file").is_err());
        assert!(validate_relative_remote_path("folder/file").is_ok());
    }

    #[test]
    fn only_transport_failures_trigger_reconnects() {
        assert!(is_sftp_transport_error("transport read"));
        assert!(!is_sftp_transport_error("permission denied"));
        assert!(!is_sftp_transport_error("SFTP_FILE_EXISTS:file.txt"));
    }

    #[test]
    fn local_download_replacement_preserves_the_new_file() {
        let test_root = std::env::temp_dir().join(format!(
            "ushell-download-test-{}-{}",
            std::process::id(),
            SFTP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&test_root).expect("create test directory");
        let target = test_root.join("target.txt");
        let part = test_root.join("target.txt.part");
        fs::write(&target, b"old").expect("write old file");
        fs::write(&part, b"new").expect("write part file");

        finalize_local_download(&part, &target, "task-1").expect("replace target");

        assert_eq!(fs::read(&target).expect("read target"), b"new");
        assert!(!part.exists());
        assert!(!local_sidecar_path(&target, "backup", "task-1").exists());
        fs::remove_dir_all(&test_root).expect("clean test directory");
    }
}
