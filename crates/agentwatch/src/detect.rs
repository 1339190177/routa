use crate::models::{AgentStats, DetectedAgent};
use anyhow::{Context, Result};
use std::collections::{BTreeMap, HashMap};
use std::process::Command;

const MAX_AGENTS: usize = 8;
const ACTIVE_CPU_THRESHOLD: f32 = 1.0;

pub fn scan_agents(repo_root: &str) -> Result<Vec<DetectedAgent>> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,ppid=,%cpu=,rss=,etime=,command="])
        .output()
        .context("run ps for agent detection")?;
    if !output.status.success() {
        anyhow::bail!("ps agent scan failed");
    }

    let stdout = String::from_utf8(output.stdout).context("decode ps output")?;
    let mut by_key = BTreeMap::new();

    for line in stdout.lines() {
        let Some(agent) = parse_agent_line(line, repo_root) else {
            continue;
        };
        by_key.entry(agent.key.clone()).or_insert(agent);
    }

    Ok(by_key.into_values().take(MAX_AGENTS).collect())
}

pub fn calculate_stats(agents: &[DetectedAgent]) -> AgentStats {
    let mut by_vendor = HashMap::new();
    let mut total_cpu = 0.0f32;
    let mut total_mem_mb = 0.0f32;
    let mut active = 0usize;

    for agent in agents {
        *by_vendor.entry(agent.vendor.clone()).or_insert(0) += 1;
        total_cpu += agent.cpu_percent;
        total_mem_mb += agent.mem_mb;
        if agent.cpu_percent >= ACTIVE_CPU_THRESHOLD {
            active += 1;
        }
    }

    AgentStats {
        total: agents.len(),
        active,
        idle: agents.len().saturating_sub(active),
        total_cpu,
        total_mem_mb,
        by_vendor,
    }
}

fn parse_agent_line(line: &str, repo_root: &str) -> Option<DetectedAgent> {
    let mut parts = line.trim().splitn(6, char::is_whitespace);
    let pid = parts.next()?.trim().parse::<u32>().ok()?;
    let _ppid = parts.next()?;
    let cpu_percent = parts.next()?.trim().parse::<f32>().ok()?;
    let rss_kb = parts.next()?.trim().parse::<f32>().ok()?;
    let etime = parts.next()?.trim();
    let command = parts.next()?.trim().to_string();
    let vendor = classify_vendor(&command)?;

    let cwd = detect_cwd(pid);
    let relevant = command.contains(repo_root)
        || cwd
            .as_deref()
            .is_some_and(|path| path == repo_root || path.starts_with(&format!("{repo_root}/")));
    if !relevant {
        return None;
    }

    Some(DetectedAgent {
        key: format!("{vendor}:{pid}"),
        vendor: vendor.to_string(),
        pid,
        cwd,
        cpu_percent,
        mem_mb: rss_kb / 1024.0,
        uptime_seconds: parse_etime_seconds(etime)?,
        command,
    })
}

fn classify_vendor(command: &str) -> Option<&'static str> {
    let lower = command.to_ascii_lowercase();
    if lower.contains("codex") {
        Some("codex")
    } else if lower.contains("claude") {
        Some("claude")
    } else if lower.contains("cursor") {
        Some("cursor")
    } else if lower.contains("copilot") {
        Some("copilot")
    } else if lower.contains("gemini") {
        Some("gemini")
    } else if lower.contains("aider") {
        Some("aider")
    } else {
        None
    }
}

fn detect_cwd(pid: u32) -> Option<String> {
    let output = Command::new("lsof")
        .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    stdout
        .lines()
        .find_map(|line| line.strip_prefix('n').map(|value| value.to_string()))
}

fn parse_etime_seconds(value: &str) -> Option<u64> {
    let mut rest = value.trim();
    let mut days = 0u64;
    if let Some((prefix, suffix)) = rest.split_once('-') {
        days = prefix.parse::<u64>().ok()?;
        rest = suffix;
    }

    let parts: Vec<_> = rest.split(':').collect();
    let seconds = match parts.as_slice() {
        [mm, ss] => mm.parse::<u64>().ok()? * 60 + ss.parse::<u64>().ok()?,
        [hh, mm, ss] => {
            hh.parse::<u64>().ok()? * 3600
                + mm.parse::<u64>().ok()? * 60
                + ss.parse::<u64>().ok()?
        }
        _ => return None,
    };
    Some(days * 86_400 + seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_known_agent_vendor() {
        assert_eq!(
            parse_agent_line(
                "123 1 12.5 204800 01:23 /usr/local/bin/codex --cwd /Users/phodal/ai/routa-js",
                "/Users/phodal/ai/routa-js"
            )
            .map(|agent| (
                agent.vendor,
                agent.cpu_percent,
                agent.mem_mb as u32,
                agent.uptime_seconds
            )),
            Some(("codex".to_string(), 12.5, 200, 83))
        );
    }

    #[test]
    fn ignore_non_agent_processes() {
        assert!(
            parse_agent_line("222 1 0.0 100 00:03 /usr/bin/vim foo.rs", "/tmp/project").is_none()
        );
    }

    #[test]
    fn parse_elapsed_time_with_days() {
        assert_eq!(parse_etime_seconds("2-03:04:05"), Some(183_845));
    }

    #[test]
    fn calculate_agent_stats_sums_process_metrics() {
        let stats = calculate_stats(&[
            DetectedAgent {
                key: "codex:1".to_string(),
                vendor: "codex".to_string(),
                pid: 1,
                cwd: None,
                cpu_percent: 3.5,
                mem_mb: 120.0,
                uptime_seconds: 10,
                command: "codex".to_string(),
            },
            DetectedAgent {
                key: "claude:2".to_string(),
                vendor: "claude".to_string(),
                pid: 2,
                cwd: None,
                cpu_percent: 0.2,
                mem_mb: 80.0,
                uptime_seconds: 20,
                command: "claude".to_string(),
            },
        ]);

        assert_eq!(stats.total, 2);
        assert_eq!(stats.active, 1);
        assert_eq!(stats.idle, 1);
        assert!((stats.total_cpu - 3.7).abs() < f32::EPSILON);
        assert!((stats.total_mem_mb - 200.0).abs() < f32::EPSILON);
        assert_eq!(stats.by_vendor.get("codex"), Some(&1));
    }
}
