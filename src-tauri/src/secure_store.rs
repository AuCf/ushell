use keyring::{Entry, Error as KeyringError};

const SERVICE_NAME: &str = "com.ushell.desktop";
const AI_API_KEY_ACCOUNT: &str = "ai-api-key";
const TRUSTED_HOSTS_ACCOUNT: &str = "trusted-hosts-index";

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedHostKey {
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
}

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, account).map_err(|error| format!("打开系统凭据库失败: {}", error))
}

pub fn set_secret(account: &str, secret: &str) -> Result<(), String> {
    entry(account)?
        .set_password(secret)
        .map_err(|error| format!("写入系统凭据库失败: {}", error))
}

pub fn get_secret(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("读取系统凭据库失败: {}", error)),
    }
}

pub fn delete_secret(account: &str) -> Result<(), String> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("删除系统凭据失败: {}", error)),
    }
}

fn server_account(server_id: &str) -> Result<String, String> {
    let server_id = server_id.trim();
    if server_id.is_empty()
        || !server_id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
    {
        return Err("服务器凭据标识无效".to_string());
    }
    Ok(format!("server:{}", server_id))
}

pub fn host_key_account(host: &str, port: u16) -> String {
    format!("host-key:{}:{}", host.trim().to_ascii_lowercase(), port)
}

fn load_trusted_hosts_index() -> Result<Vec<TrustedHostKey>, String> {
    let Some(raw) = get_secret(TRUSTED_HOSTS_ACCOUNT)? else {
        return Ok(Vec::new());
    };
    serde_json::from_str(&raw).map_err(|error| format!("读取已信任主机索引失败: {}", error))
}

fn save_trusted_hosts_index(hosts: &[TrustedHostKey]) -> Result<(), String> {
    let raw = serde_json::to_string(hosts)
        .map_err(|error| format!("保存已信任主机索引失败: {}", error))?;
    set_secret(TRUSTED_HOSTS_ACCOUNT, &raw)
}

pub fn remember_trusted_host(host_key: TrustedHostKey) -> Result<(), String> {
    set_secret(
        &host_key_account(&host_key.host, host_key.port),
        &format!("{}|{}", host_key.algorithm, host_key.fingerprint),
    )?;
    index_trusted_host(host_key)
}

pub fn index_trusted_host(host_key: TrustedHostKey) -> Result<(), String> {
    let mut hosts = load_trusted_hosts_index()?;
    if hosts.iter().any(|value| {
        value.host.eq_ignore_ascii_case(&host_key.host)
            && value.port == host_key.port
            && value.algorithm == host_key.algorithm
            && value.fingerprint == host_key.fingerprint
    }) {
        return Ok(());
    }
    hosts.retain(|value| {
        !(value.host.eq_ignore_ascii_case(&host_key.host) && value.port == host_key.port)
    });
    hosts.push(host_key);
    hosts.sort_by(|left, right| {
        left.host
            .to_ascii_lowercase()
            .cmp(&right.host.to_ascii_lowercase())
            .then(left.port.cmp(&right.port))
    });
    save_trusted_hosts_index(&hosts)
}

#[tauri::command]
pub async fn list_trusted_hosts() -> Result<Vec<TrustedHostKey>, String> {
    tauri::async_runtime::spawn_blocking(load_trusted_hosts_index)
        .await
        .map_err(|error| format!("读取已信任主机任务异常: {}", error))?
}

#[tauri::command]
pub async fn delete_trusted_host(host: String, port: u16) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_secret(&host_key_account(&host, port))?;
        let mut hosts = load_trusted_hosts_index()?;
        hosts.retain(|value| !(value.host.eq_ignore_ascii_case(&host) && value.port == port));
        save_trusted_hosts_index(&hosts)
    })
    .await
    .map_err(|error| format!("删除已信任主机任务异常: {}", error))?
}

#[tauri::command]
pub async fn save_server_secret(server_id: String, secret: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set_secret(&server_account(&server_id)?, &secret))
        .await
        .map_err(|error| format!("保存服务器凭据任务异常: {}", error))?
}

#[tauri::command]
pub async fn load_server_secret(server_id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || get_secret(&server_account(&server_id)?))
        .await
        .map_err(|error| format!("读取服务器凭据任务异常: {}", error))?
}

#[tauri::command]
pub async fn delete_server_secret(server_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_secret(&server_account(&server_id)?))
        .await
        .map_err(|error| format!("删除服务器凭据任务异常: {}", error))?
}

#[tauri::command]
pub async fn save_ai_api_key(api_key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if api_key.is_empty() {
            delete_secret(AI_API_KEY_ACCOUNT)
        } else {
            set_secret(AI_API_KEY_ACCOUNT, &api_key)
        }
    })
    .await
    .map_err(|error| format!("保存 AI API Key 任务异常: {}", error))?
}

#[tauri::command]
pub async fn load_ai_api_key() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || get_secret(AI_API_KEY_ACCOUNT))
        .await
        .map_err(|error| format!("读取 AI API Key 任务异常: {}", error))?
}
