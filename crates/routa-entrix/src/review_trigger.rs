use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct DiffStats {
    pub file_count: usize,
    pub added_lines: usize,
    pub deleted_lines: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewTriggerRule {
    pub name: String,
    #[serde(rename = "type")]
    pub type_field: String,
    #[serde(default = "default_severity")]
    pub severity: String,
    #[serde(default = "default_action")]
    pub action: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub directories: Vec<String>,
    #[serde(default)]
    pub max_files: Option<usize>,
    #[serde(default)]
    pub max_added_lines: Option<usize>,
    #[serde(default)]
    pub max_deleted_lines: Option<usize>,
    #[serde(default)]
    pub evidence_paths: Vec<String>,
    #[serde(default)]
    pub boundaries: std::collections::BTreeMap<String, Vec<String>>,
    #[serde(default = "default_min_boundaries")]
    pub min_boundaries: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TriggerMatch {
    pub name: String,
    pub severity: String,
    pub action: String,
    #[serde(default)]
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewTriggerReport {
    pub human_review_required: bool,
    pub base: String,
    #[serde(default)]
    pub changed_files: Vec<String>,
    pub diff_stats: DiffStats,
    #[serde(default)]
    pub triggers: Vec<TriggerMatch>,
}

#[derive(Debug, Deserialize)]
struct ReviewTriggerConfig {
    #[serde(default)]
    review_triggers: Vec<ReviewTriggerRule>,
}

fn default_severity() -> String {
    "medium".to_string()
}

fn default_action() -> String {
    "require_human_review".to_string()
}

fn default_min_boundaries() -> usize {
    2
}

pub fn load_review_triggers(config_path: &Path) -> Result<Vec<ReviewTriggerRule>, String> {
    let raw = std::fs::read_to_string(config_path)
        .map_err(|error| format!("failed to read {}: {error}", config_path.display()))?;
    let parsed = serde_yaml::from_str::<ReviewTriggerConfig>(&raw)
        .map_err(|error| format!("invalid review trigger yaml: {error}"))?;
    Ok(parsed.review_triggers)
}

pub fn collect_changed_files(repo_root: &Path, base: &str) -> Vec<String> {
    let commands = [
        vec!["diff", "--name-only", "--diff-filter=ACMR", base],
        vec!["diff", "--name-only", "--diff-filter=ACMR"],
        vec!["ls-files", "--others", "--exclude-standard"],
    ];
    let mut seen = std::collections::BTreeSet::new();
    let mut files = Vec::new();
    for args in commands {
        let output = Command::new("git").args(args).current_dir(repo_root).output();
        let Ok(output) = output else {
            continue;
        };
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
                continue;
            }
            files.push(trimmed.to_string());
        }
    }
    files
}

pub fn collect_diff_stats(repo_root: &Path, base: &str) -> DiffStats {
    let output = Command::new("git")
        .args(["diff", "--numstat", "--diff-filter=ACMR", base])
        .current_dir(repo_root)
        .output();
    let Ok(output) = output else {
        return DiffStats::default();
    };

    let mut stats = DiffStats::default();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let parts = line.split('\t').collect::<Vec<_>>();
        if parts.len() != 3 || parts[0] == "-" || parts[1] == "-" {
            continue;
        }
        let Ok(added) = parts[0].parse::<usize>() else {
            continue;
        };
        let Ok(deleted) = parts[1].parse::<usize>() else {
            continue;
        };
        stats.file_count += 1;
        stats.added_lines += added;
        stats.deleted_lines += deleted;
    }
    stats
}

pub fn evaluate_review_triggers(
    rules: &[ReviewTriggerRule],
    changed_files: &[String],
    diff_stats: &DiffStats,
    base: &str,
    repo_root: Option<&Path>,
) -> ReviewTriggerReport {
    let mut triggers = Vec::new();
    for rule in rules {
        match rule.type_field.as_str() {
            "changed_paths" | "sensitive_file_change" => {
                let prefix = if rule.type_field == "changed_paths" {
                    "changed path"
                } else {
                    "sensitive file changed"
                };
                let reasons = changed_files
                    .iter()
                    .filter(|file_path| {
                        rule.paths.iter().any(|pattern| glob_matches(pattern, file_path))
                    })
                    .map(|file_path| format!("{prefix}: {file_path}"))
                    .collect::<Vec<_>>();
                if !reasons.is_empty() {
                    triggers.push(TriggerMatch {
                        name: rule.name.clone(),
                        severity: rule.severity.clone(),
                        action: rule.action.clone(),
                        reasons,
                    });
                }
            }
            "diff_size" => {
                let mut reasons = Vec::new();
                if let Some(max_files) = rule.max_files {
                    if diff_stats.file_count > max_files {
                        reasons.push(format!(
                            "diff touched {} files (threshold: {})",
                            diff_stats.file_count, max_files
                        ));
                    }
                }
                if let Some(max_added_lines) = rule.max_added_lines {
                    if diff_stats.added_lines > max_added_lines {
                        reasons.push(format!(
                            "diff added {} lines (threshold: {})",
                            diff_stats.added_lines, max_added_lines
                        ));
                    }
                }
                if let Some(max_deleted_lines) = rule.max_deleted_lines {
                    if diff_stats.deleted_lines > max_deleted_lines {
                        reasons.push(format!(
                            "diff deleted {} lines (threshold: {})",
                            diff_stats.deleted_lines, max_deleted_lines
                        ));
                    }
                }
                if !reasons.is_empty() {
                    triggers.push(TriggerMatch {
                        name: rule.name.clone(),
                        severity: rule.severity.clone(),
                        action: rule.action.clone(),
                        reasons,
                    });
                }
            }
            "directory_file_count" => {
                let Some(repo_root) = repo_root else {
                    continue;
                };
                let Some(max_files) = rule.max_files else {
                    continue;
                };
                let mut reasons = Vec::new();
                for directory in &rule.directories {
                    let touched_files = changed_files_in_directory(changed_files, directory);
                    if touched_files.is_empty() {
                        continue;
                    }
                    let file_count = count_direct_files(repo_root, directory);
                    if file_count > max_files {
                        let mut changed_sample = touched_files.iter().take(3).cloned().collect::<Vec<_>>().join(", ");
                        if touched_files.len() > 3 {
                            changed_sample.push_str(", ...");
                        }
                        reasons.push(format!(
                            "directory '{}' has {} direct files (threshold: {}); changed files: {}",
                            directory, file_count, max_files, changed_sample
                        ));
                    }
                }
                if !reasons.is_empty() {
                    triggers.push(TriggerMatch {
                        name: rule.name.clone(),
                        severity: rule.severity.clone(),
                        action: rule.action.clone(),
                        reasons,
                    });
                }
            }
            "evidence_gap" => {
                let monitored_changes = changed_files
                    .iter()
                    .filter(|file_path| {
                        rule.paths.iter().any(|pattern| glob_matches(pattern, file_path))
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                if monitored_changes.is_empty() {
                    continue;
                }
                let evidence_touched = changed_files.iter().any(|file_path| {
                    rule.evidence_paths
                        .iter()
                        .any(|pattern| glob_matches(pattern, file_path))
                });
                if !evidence_touched {
                    let mut reasons = monitored_changes
                        .iter()
                        .map(|path| format!("changed code path without evidence update: {path}"))
                        .collect::<Vec<_>>();
                    reasons.push(format!(
                        "expected evidence path patterns: {}",
                        rule.evidence_paths.join(", ")
                    ));
                    triggers.push(TriggerMatch {
                        name: rule.name.clone(),
                        severity: rule.severity.clone(),
                        action: rule.action.clone(),
                        reasons,
                    });
                }
            }
            "cross_boundary_change" => {
                let mut boundary_hits = std::collections::BTreeMap::new();
                for (boundary_name, patterns) in &rule.boundaries {
                    let matches = changed_files
                        .iter()
                        .filter(|file_path| patterns.iter().any(|pattern| glob_matches(pattern, file_path)))
                        .cloned()
                        .collect::<Vec<_>>();
                    if !matches.is_empty() {
                        boundary_hits.insert(boundary_name.clone(), matches);
                    }
                }
                if boundary_hits.len() >= rule.min_boundaries {
                    let reasons = boundary_hits
                        .into_iter()
                        .map(|(boundary_name, paths)| {
                            format!("changed boundary '{}': {}", boundary_name, paths.join(", "))
                        })
                        .collect::<Vec<_>>();
                    triggers.push(TriggerMatch {
                        name: rule.name.clone(),
                        severity: rule.severity.clone(),
                        action: rule.action.clone(),
                        reasons,
                    });
                }
            }
            _ => {}
        }
    }

    ReviewTriggerReport {
        human_review_required: !triggers.is_empty(),
        base: base.to_string(),
        changed_files: changed_files.to_vec(),
        diff_stats: diff_stats.clone(),
        triggers,
    }
}

fn glob_matches(pattern: &str, path: &str) -> bool {
    glob::Pattern::new(pattern)
        .map(|compiled| compiled.matches(path))
        .unwrap_or(false)
}

fn changed_files_in_directory(changed_files: &[String], directory: &str) -> Vec<String> {
    let normalized = directory.trim().trim_matches('/');
    if normalized.is_empty() {
        return Vec::new();
    }
    let prefix = format!("{normalized}/");
    changed_files
        .iter()
        .filter(|file_path| *file_path == normalized || file_path.starts_with(&prefix))
        .cloned()
        .collect()
}

fn count_direct_files(repo_root: &Path, directory: &str) -> usize {
    let target = repo_root.join(directory);
    if !target.is_dir() {
        return 0;
    }
    std::fs::read_dir(target)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .filter(|entry| entry.path().is_file())
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn evaluate_review_triggers_matches_changed_paths() {
        let report = evaluate_review_triggers(
            &[ReviewTriggerRule {
                name: "critical".into(),
                type_field: "changed_paths".into(),
                severity: "high".into(),
                action: "require_human_review".into(),
                paths: vec!["src/**".into()],
                directories: Vec::new(),
                max_files: None,
                max_added_lines: None,
                max_deleted_lines: None,
                evidence_paths: Vec::new(),
                boundaries: Default::default(),
                min_boundaries: 2,
            }],
            &[String::from("src/app.ts")],
            &DiffStats::default(),
            "HEAD~1",
            None,
        );
        assert!(report.human_review_required);
        assert_eq!(report.triggers.len(), 1);
    }

    #[test]
    fn evaluate_review_triggers_returns_clean_report() {
        let report = evaluate_review_triggers(&[], &[], &DiffStats::default(), "HEAD~1", None);
        assert!(!report.human_review_required);
        assert!(report.triggers.is_empty());
    }

    #[test]
    fn directory_file_count_counts_direct_children() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("scripts");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("a.sh"), "echo a\n").unwrap();
        std::fs::write(target.join("b.sh"), "echo b\n").unwrap();

        let report = evaluate_review_triggers(
            &[ReviewTriggerRule {
                name: "scripts".into(),
                type_field: "directory_file_count".into(),
                severity: "medium".into(),
                action: "require_human_review".into(),
                paths: Vec::new(),
                directories: vec!["scripts".into()],
                max_files: Some(1),
                max_added_lines: None,
                max_deleted_lines: None,
                evidence_paths: Vec::new(),
                boundaries: Default::default(),
                min_boundaries: 2,
            }],
            &[String::from("scripts/a.sh")],
            &DiffStats::default(),
            "HEAD~1",
            Some(dir.path()),
        );
        assert!(report.human_review_required);
    }
}
