use ssh2::Session;
use std::io::Read;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMetric {
    pid: u32,
    name: String,
    cpu: f64,
    mem: f64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerMetrics {
    timestamp: u64,
    cpu_usage: f64,
    cpu_cores: u32,
    memory_total_mb: u64,
    memory_used_mb: u64,
    memory_usage: f64,
    disk_used_gb: f64,
    disk_total_gb: f64,
    disk_usage: f64,
    net_rx_bytes: u64,
    net_tx_bytes: u64,
    top_processes: Vec<ProcessMetric>,
}

const METRICS_COMMAND: &str = r#"LC_ALL=C sh -c '
cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 1)
read _ u1 n1 s1 i1 w1 q1 sq1 st1 _ _ < /proc/stat
total1=$((u1+n1+s1+i1+w1+q1+sq1+st1)); idle1=$((i1+w1))
sleep 0.2
read _ u2 n2 s2 i2 w2 q2 sq2 st2 _ _ < /proc/stat
total2=$((u2+n2+s2+i2+w2+q2+sq2+st2)); idle2=$((i2+w2))
cpu=$(awk -v total="$((total2-total1))" -v idle="$((idle2-idle1))" "BEGIN{if(total<=0)print 0;else printf \"%.2f\",(total-idle)*100/total}")
printf "CPU|%s|%s\n" "$cpu" "$cores"
awk "/MemTotal:/{t=\$2}/MemAvailable:/{a=\$2}END{printf \"MEM|%d|%d\\n\",(t-a)/1024,t/1024}" /proc/meminfo
df -Pk / | awk "NR==2{printf \"DISK|%.3f|%.3f|%s\\n\",\$3/1048576,\$2/1048576,\$5}"
awk -F"[: ]+" "NR>2{rx+=\$3;tx+=\$11}END{printf \"NET|%.0f|%.0f\\n\",rx,tx}" /proc/net/dev
ps -eo pid=,comm=,%cpu=,%mem= --sort=-%cpu | head -n 5 | awk "{printf \"PROC|%s|%s|%s|%s\\n\",\$1,\$2,\$3,\$4}"
'"#;

pub fn collect(session: &Session) -> Result<ServerMetrics, String> {
    let mut channel = session
        .channel_session()
        .map_err(|error| format!("创建监控通道失败: {}", error))?;
    channel
        .exec(METRICS_COMMAND)
        .map_err(|error| format!("启动服务器监控采集失败: {}", error))?;
    let mut output = String::new();
    channel
        .read_to_string(&mut output)
        .map_err(|error| format!("读取服务器监控数据失败: {}", error))?;
    channel
        .wait_close()
        .map_err(|error| format!("关闭服务器监控通道失败: {}", error))?;
    parse_metrics(&output)
}

fn number<T: std::str::FromStr>(value: Option<&str>, label: &str) -> Result<T, String> {
    value
        .ok_or_else(|| format!("服务器监控缺少 {} 数据", label))?
        .trim_end_matches('%')
        .parse()
        .map_err(|_| format!("服务器监控的 {} 数据无效", label))
}

pub fn parse_metrics(output: &str) -> Result<ServerMetrics, String> {
    let mut cpu_usage = None;
    let mut cpu_cores = None;
    let mut memory = None;
    let mut disk = None;
    let mut network = None;
    let mut top_processes = Vec::new();

    for line in output.lines() {
        let mut fields = line.split('|');
        match fields.next() {
            Some("CPU") => {
                let usage: f64 = number(fields.next(), "CPU usage")?;
                let cores: u32 = number(fields.next(), "CPU cores")?;
                cpu_cores = Some(cores.max(1));
                cpu_usage = Some(usage.clamp(0.0, 100.0));
            }
            Some("MEM") => {
                memory = Some((
                    number::<u64>(fields.next(), "memory used")?,
                    number::<u64>(fields.next(), "memory total")?,
                ));
            }
            Some("DISK") => {
                disk = Some((
                    number::<f64>(fields.next(), "disk used")?,
                    number::<f64>(fields.next(), "disk total")?,
                    number::<f64>(fields.next(), "disk usage")?,
                ));
            }
            Some("NET") => {
                network = Some((
                    number::<u64>(fields.next(), "network received")?,
                    number::<u64>(fields.next(), "network transmitted")?,
                ));
            }
            Some("PROC") => top_processes.push(ProcessMetric {
                pid: number(fields.next(), "process pid")?,
                name: fields.next().unwrap_or("unknown").to_string(),
                cpu: number(fields.next(), "process cpu")?,
                mem: number(fields.next(), "process memory")?,
            }),
            _ => {}
        }
    }

    let (memory_used_mb, memory_total_mb) =
        memory.ok_or_else(|| "服务器未返回内存数据".to_string())?;
    let (disk_used_gb, disk_total_gb, disk_usage) =
        disk.ok_or_else(|| "服务器未返回磁盘数据".to_string())?;
    let (net_rx_bytes, net_tx_bytes) = network.ok_or_else(|| "服务器未返回网络数据".to_string())?;
    Ok(ServerMetrics {
        timestamp: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        cpu_usage: cpu_usage.ok_or_else(|| "服务器未返回 CPU 数据".to_string())?,
        cpu_cores: cpu_cores.unwrap_or(1),
        memory_total_mb,
        memory_used_mb,
        memory_usage: if memory_total_mb == 0 {
            0.0
        } else {
            memory_used_mb as f64 / memory_total_mb as f64 * 100.0
        },
        disk_used_gb,
        disk_total_gb,
        disk_usage,
        net_rx_bytes,
        net_tx_bytes,
        top_processes,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_metrics;

    #[test]
    fn parses_linux_metrics_output() {
        let result = parse_metrics(
            "CPU|25.0|4\nMEM|512|1024\nDISK|10.0|20.0|50%\nNET|1000|2000\nPROC|10|sshd|1.5|0.2\n",
        )
        .unwrap();
        assert_eq!(result.cpu_cores, 4);
        assert_eq!(result.memory_used_mb, 512);
        assert_eq!(result.top_processes.len(), 1);
    }
}
