//! GitLab API integration for Kanban task sync.
//!
//! Provides functions to interact with the GitLab REST API (v4) for:
//! - Resolving GitLab project paths from URLs
//! - Listing GitLab issues and merge requests
//! - Token resolution (board token → env var → `glab` CLI)
//! - URL parsing utilities for GitLab repositories

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, USER_AGENT};
use std::process::Command;

// ─── Data types ─────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct GitLabIssueRef {
    pub id: String,
    pub iid: i64,
    pub url: String,
    pub state: String,
    pub project: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLabIssueListItem {
    pub id: String,
    pub iid: i64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub url: String,
    pub state: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLabMergeRequestListItem {
    pub id: String,
    pub iid: i64,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub url: String,
    pub state: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    pub draft: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merged_at: Option<String>,
    pub source_branch: String,
    pub target_branch: String,
}

// ─── URL parsing ────────────────────────────────────────────────────────────

/// Parsed components of a GitLab URL.
#[derive(Debug, Clone)]
pub struct ParsedGitLabUrl {
    /// GitLab host, e.g. "gitlab.com" or "gitlab.example.com"
    pub host: String,
    /// URL-encoded project path, e.g. "group/subgroup/project"
    pub project: String,
}

/// Parse a GitLab URL or `group/project` shorthand into its components.
///
/// Supports:
/// - `https://gitlab.com/group/subgroup/project`
/// - `https://gitlab.com/group/subgroup/project.git`
/// - `git@gitlab.com:group/subgroup/project.git`
/// - `gitlab.com/group/subgroup/project`
/// - `group/project` (defaults host to `gitlab.com`)
pub fn parse_gitlab_url(url: &str) -> Option<ParsedGitLabUrl> {
    let trimmed = url.trim().trim_end_matches('/');

    // HTTPS pattern: https://host/group/.../project[.git]
    let https_re =
        regex::Regex::new(r"^https?://([^/]+)/(.+?)(?:\.git)?(?:/|$)").ok()?;
    if let Some(caps) = https_re.captures(trimmed) {
        let host = caps.get(1)?.as_str().to_string();
        let project = caps.get(2)?.as_str().to_string();
        if is_valid_host(&host) && !project.is_empty() {
            return Some(ParsedGitLabUrl { host, project });
        }
    }

    // SSH pattern: git@host:group/.../project.git
    let ssh_re =
        regex::Regex::new(r"^git@([^:]+):(.+?)(?:\.git)?$").ok()?;
    if let Some(caps) = ssh_re.captures(trimmed) {
        let host = caps.get(1)?.as_str().to_string();
        let project = caps.get(2)?.as_str().to_string();
        if is_valid_host(&host) && !project.is_empty() {
            return Some(ParsedGitLabUrl { host, project });
        }
    }

    // Host-less shorthand: host/path (e.g. gitlab.com/group/project)
    let host_path_re =
        regex::Regex::new(r"^([a-zA-Z0-9._-]+\.[a-zA-Z]{2,})/(.+?)(?:\.git)?(?:/|$)").ok()?;
    if let Some(caps) = host_path_re.captures(trimmed) {
        let host = caps.get(1)?.as_str().to_string();
        let project = caps.get(2)?.as_str().to_string();
        if is_valid_host(&host) && !project.is_empty() {
            return Some(ParsedGitLabUrl { host, project });
        }
    }

    // Plain group/project shorthand (defaults to gitlab.com)
    let shorthand_re =
        regex::Regex::new(r"^([a-zA-Z0-9._\-/]+)/([a-zA-Z0-9._\-]+)$").ok()?;
    if let Some(caps) = shorthand_re.captures(trimmed) {
        if !trimmed.contains('\\') && !trimmed.contains(':') {
            let group = caps.get(1)?.as_str();
            let project_name = caps.get(2)?.as_str();
            // Must have at least group/project
            if !group.is_empty() && !project_name.is_empty() {
                return Some(ParsedGitLabUrl {
                    host: "gitlab.com".to_string(),
                    project: format!("{group}/{project_name}"),
                });
            }
        }
    }

    None
}

fn is_valid_host(host: &str) -> bool {
    // Reject common non-GitLab hosts
    !host.starts_with("github.")
        && !host.starts_with("localhost")
        && !host.contains("127.0.0.1")
}

// ─── Token resolution ──────────────────────────────────────────────────────

/// Resolve a GitLab API token from board token, env var, or `glab` CLI.
pub fn resolve_gitlab_token(board_token: Option<&str>) -> Option<String> {
    board_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            std::env::var("GITLAB_TOKEN")
                .ok()
                .filter(|value| !value.is_empty())
        })
        .or_else(|| {
            let output = Command::new("glab").args(["auth", "token"]).output().ok()?;
            if !output.status.success() {
                return None;
            }
            let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if token.is_empty() {
                None
            } else {
                Some(token)
            }
        })
}

/// Check GitLab API access availability.
pub fn gitlab_access_status(board_token: Option<&str>) -> (&'static str, bool) {
    if board_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        return ("board", true);
    }

    if std::env::var("GITLAB_TOKEN")
        .ok()
        .filter(|value| !value.is_empty())
        .is_some()
    {
        return ("env", true);
    }

    let output = match Command::new("glab").args(["auth", "token"]).output() {
        Ok(output) => output,
        Err(_) => return ("none", false),
    };

    if !output.status.success() {
        return ("none", false);
    }

    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        ("none", false)
    } else {
        ("glab", true)
    }
}

// ─── Project path resolution ───────────────────────────────────────────────

/// Resolve the GitLab project path from a codebase's source URL or local repo.
pub fn resolve_gitlab_project_for_codebase(
    source_url: Option<&str>,
    repo_path: Option<&str>,
) -> Option<String> {
    source_url
        .and_then(parse_gitlab_url)
        .map(|parsed| parsed.project)
        .or_else(|| resolve_gitlab_project(repo_path))
}

/// Resolve the GitLab project from a local repo's remote origin URL.
fn resolve_gitlab_project(repo_path: Option<&str>) -> Option<String> {
    let repo_path = repo_path?;
    let output = crate::git::git_command()
        .args(["config", "--get", "remote.origin.url"])
        .current_dir(repo_path)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let remote = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed = parse_gitlab_url(&remote)?;
    Some(parsed.project)
}

// ─── GitLab API request helper ─────────────────────────────────────────────

/// Build a GitLab API v4 request with proper headers.
fn gitlab_request(
    request: reqwest::RequestBuilder,
    host: &str,
    token: Option<String>,
) -> reqwest::RequestBuilder {
    let builder = request
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "routa-rust-kanban");

    match token {
        Some(token) => builder.header(AUTHORIZATION, format!("Bearer {token}")),
        None => builder,
    }
}

/// Determine the API base URL for a given GitLab host.
fn gitlab_api_base(host: &str) -> String {
    // Support self-hosted GitLab instances
    if host == "gitlab.com" {
        "https://gitlab.com/api/v4".to_string()
    } else {
        format!("https://{host}/api/v4")
    }
}

// ─── List issues ────────────────────────────────────────────────────────────

/// List GitLab issues for a project.
pub async fn list_gitlab_issues(
    host: &str,
    project: &str,
    state: Option<&str>,
    per_page: Option<usize>,
    board_token: Option<&str>,
) -> Result<Vec<GitLabIssueListItem>, String> {
    let client = reqwest::Client::new();
    let token = resolve_gitlab_token(board_token);
    let per_page = per_page.unwrap_or(50).clamp(1, 100);
    let state = state.unwrap_or("opened");
    let encoded_project = urlencoding::encode(project);
    let base = gitlab_api_base(host);
    let url = format!(
        "{base}/projects/{encoded_project}/issues?state={state}&sort=updated_at&order_by=desc&per_page={per_page}"
    );

    let response = gitlab_request(client.get(&url), host, token)
        .send()
        .await
        .map_err(|error| format!("GitLab issue list failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("GitLab issue list failed: {status} {text}"));
    }

    let data = response
        .json::<Vec<serde_json::Value>>()
        .await
        .map_err(|error| format!("GitLab issue list failed: {error}"))?;

    Ok(data
        .into_iter()
        .map(|item| GitLabIssueListItem {
            id: item
                .get("id")
                .and_then(|value| value.as_i64())
                .unwrap_or_default()
                .to_string(),
            iid: item
                .get("iid")
                .and_then(|value| value.as_i64())
                .unwrap_or_default(),
            title: item
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            body: item
                .get("description")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            url: item
                .get("web_url")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            state: map_gitlab_issue_state(
                item.get("state")
                    .and_then(|value| value.as_str())
                    .unwrap_or("opened"),
            ),
            labels: item
                .get("labels")
                .and_then(|value| value.as_array())
                .map(|labels| {
                    labels
                        .iter()
                        .filter_map(|label| {
                            // GitLab labels can be strings or objects
                            match label {
                                serde_json::Value::String(s) => {
                                    let trimmed = s.trim();
                                    if trimmed.is_empty() {
                                        None
                                    } else {
                                        Some(trimmed.to_string())
                                    }
                                }
                                serde_json::Value::Object(obj) => obj
                                    .get("name")
                                    .and_then(|value| value.as_str())
                                    .map(str::trim)
                                    .filter(|value| !value.is_empty())
                                    .map(str::to_string),
                                _ => None,
                            }
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            assignees: item
                .get("assignees")
                .and_then(|value| value.as_array())
                .map(|assignees| {
                    assignees
                        .iter()
                        .filter_map(|assignee| {
                            assignee
                                .get("username")
                                .and_then(|value| value.as_str())
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(str::to_string)
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            updated_at: item
                .get("updated_at")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        })
        .collect())
}

// ─── List merge requests ───────────────────────────────────────────────────

/// List GitLab merge requests for a project.
pub async fn list_gitlab_merge_requests(
    host: &str,
    project: &str,
    state: Option<&str>,
    per_page: Option<usize>,
    board_token: Option<&str>,
) -> Result<Vec<GitLabMergeRequestListItem>, String> {
    let client = reqwest::Client::new();
    let token = resolve_gitlab_token(board_token);
    let per_page = per_page.unwrap_or(50).clamp(1, 100);
    let state = state.unwrap_or("opened");
    let encoded_project = urlencoding::encode(project);
    let base = gitlab_api_base(host);
    let url = format!(
        "{base}/projects/{encoded_project}/merge_requests?state={state}&sort=updated_at&order_by=desc&per_page={per_page}"
    );

    let response = gitlab_request(client.get(&url), host, token)
        .send()
        .await
        .map_err(|error| format!("GitLab merge request list failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("GitLab merge request list failed: {status} {text}"));
    }

    let data = response
        .json::<Vec<serde_json::Value>>()
        .await
        .map_err(|error| format!("GitLab merge request list failed: {error}"))?;

    Ok(data
        .into_iter()
        .map(|item| GitLabMergeRequestListItem {
            id: item
                .get("id")
                .and_then(|value| value.as_i64())
                .unwrap_or_default()
                .to_string(),
            iid: item
                .get("iid")
                .and_then(|value| value.as_i64())
                .unwrap_or_default(),
            title: item
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            body: item
                .get("description")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            url: item
                .get("web_url")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            state: map_gitlab_mr_state(
                item.get("state")
                    .and_then(|value| value.as_str())
                    .unwrap_or("opened"),
                item.get("merged_at")
                    .and_then(|value| value.as_str())
                    .is_some(),
            ),
            labels: item
                .get("labels")
                .and_then(|value| value.as_array())
                .map(|labels| {
                    labels
                        .iter()
                        .filter_map(|label| match label {
                            serde_json::Value::String(s) => {
                                let trimmed = s.trim();
                                if trimmed.is_empty() {
                                    None
                                } else {
                                    Some(trimmed.to_string())
                                }
                            }
                            serde_json::Value::Object(obj) => obj
                                .get("name")
                                .and_then(|value| value.as_str())
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(str::to_string),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            assignees: item
                .get("assignees")
                .and_then(|value| value.as_array())
                .map(|assignees| {
                    assignees
                        .iter()
                        .filter_map(|assignee| {
                            assignee
                                .get("username")
                                .and_then(|value| value.as_str())
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(str::to_string)
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
            updated_at: item
                .get("updated_at")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            draft: item
                .get("draft")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
            merged_at: item
                .get("merged_at")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            source_branch: item
                .get("source_branch")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
            target_branch: item
                .get("target_branch")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string(),
        })
        .collect())
}

// ─── State mapping ─────────────────────────────────────────────────────────

/// Map GitLab issue state to a normalized state string.
fn map_gitlab_issue_state(state: &str) -> String {
    match state {
        "opened" => "open".to_string(),
        "closed" => "closed".to_string(),
        other => other.to_string(),
    }
}

/// Map GitLab MR state to a normalized state string.
fn map_gitlab_mr_state(state: &str, is_merged: bool) -> String {
    match state {
        "merged" | "closed" if is_merged => "merged".to_string(),
        "closed" => "closed".to_string(),
        "opened" => "open".to_string(),
        other => other.to_string(),
    }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::{gitlab_access_status, parse_gitlab_url, resolve_gitlab_token};

    #[test]
    fn parse_gitlab_https_url() {
        let parsed = parse_gitlab_url("https://gitlab.com/mygroup/myproject").unwrap();
        assert_eq!(parsed.host, "gitlab.com");
        assert_eq!(parsed.project, "mygroup/myproject");
    }

    #[test]
    fn parse_gitlab_https_url_with_git_suffix() {
        let parsed =
            parse_gitlab_url("https://gitlab.com/mygroup/myproject.git").unwrap();
        assert_eq!(parsed.host, "gitlab.com");
        assert_eq!(parsed.project, "mygroup/myproject");
    }

    #[test]
    fn parse_gitlab_https_url_nested_group() {
        let parsed =
            parse_gitlab_url("https://gitlab.com/org/subgroup/team/project").unwrap();
        assert_eq!(parsed.host, "gitlab.com");
        assert_eq!(parsed.project, "org/subgroup/team/project");
    }

    #[test]
    fn parse_gitlab_ssh_url() {
        let parsed =
            parse_gitlab_url("git@gitlab.com:mygroup/myproject.git").unwrap();
        assert_eq!(parsed.host, "gitlab.com");
        assert_eq!(parsed.project, "mygroup/myproject");
    }

    #[test]
    fn parse_gitlab_self_hosted() {
        let parsed =
            parse_gitlab_url("https://gitlab.example.com/team/repo").unwrap();
        assert_eq!(parsed.host, "gitlab.example.com");
        assert_eq!(parsed.project, "team/repo");
    }

    #[test]
    fn parse_gitlab_shorthand() {
        let parsed = parse_gitlab_url("mygroup/myproject").unwrap();
        assert_eq!(parsed.host, "gitlab.com");
        assert_eq!(parsed.project, "mygroup/myproject");
    }

    #[test]
    fn parse_gitlab_rejects_github_url() {
        assert!(parse_gitlab_url("https://github.com/owner/repo").is_none());
    }

    #[test]
    fn parse_gitlab_rejects_local_path() {
        assert!(parse_gitlab_url(r"C:\tmp\repo").is_none());
    }

    #[test]
    fn gitlab_access_status_prefers_board_token() {
        let _env = env_lock();
        let _guard = _env.lock().expect("env lock");
        let _token = EnvGuard::remove("GITLAB_TOKEN");

        assert_eq!(
            gitlab_access_status(Some(" glpat-board-token ")),
            ("board", true)
        );
        assert_eq!(
            resolve_gitlab_token(Some(" glpat-board-token ")),
            Some("glpat-board-token".to_string())
        );
    }

    // ─── test helpers ───────────────────────────────────────────────────

    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvGuard {
        key: &'static str,
        previous: Option<String>,
    }

    impl EnvGuard {
        fn remove(key: &'static str) -> Self {
            let previous = std::env::var(key).ok();
            unsafe { std::env::remove_var(key) };
            Self { key, previous }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            unsafe {
                match &self.previous {
                    Some(previous) => std::env::set_var(self.key, previous),
                    None => std::env::remove_var(self.key),
                }
            }
        }
    }
}
