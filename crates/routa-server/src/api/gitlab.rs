//! GitLab API routes — /api/gitlab
//!
//! Mirrors the GitHub API module structure (`github.rs`) for GitLab:
//!
//! GET  /api/gitlab/access      - Check GitLab API access status
//! GET  /api/gitlab/issues      - List GitLab issues for a workspace codebase
//! GET  /api/gitlab/merge_requests - List GitLab merge requests

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::api::tasks_gitlab::{
    gitlab_access_status, list_gitlab_issues, list_gitlab_merge_requests,
    parse_gitlab_url, resolve_gitlab_project_for_codebase,
};
use crate::error::ServerError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/access", get(gitlab_access))
        .route("/issues", get(list_issues))
        .route("/merge_requests", get(list_merge_requests))
}

// ─── Access check ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccessQuery {
    board_id: Option<String>,
}

async fn load_board_token(
    state: &AppState,
    board_id: Option<&str>,
) -> Result<Option<String>, ServerError> {
    let Some(board_id) = board_id.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    // Reuse the existing github_token field as a generic VCS token slot.
    // The frontend stores either a GitHub or GitLab PAT depending on the
    // codebase source type.
    Ok(state
        .kanban_store
        .get(board_id)
        .await?
        .and_then(|board| board.github_token))
}

async fn gitlab_access(
    State(state): State<AppState>,
    Query(q): Query<AccessQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let board_token = load_board_token(&state, q.board_id.as_deref()).await?;
    let (source, available) = gitlab_access_status(board_token.as_deref());
    Ok(Json(serde_json::json!({
        "available": available,
        "source": source,
    })))
}

// ─── List issues ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueQuery {
    workspace_id: Option<String>,
    codebase_id: Option<String>,
    board_id: Option<String>,
    state: Option<String>,
}

async fn list_issues(
    State(state): State<AppState>,
    Query(q): Query<IssueQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = q
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("workspaceId is required".to_string()))?;

    let state_filter = match q.state.as_deref().unwrap_or("opened") {
        "opened" | "closed" | "all" => q.state.as_deref().unwrap_or("opened"),
        _ => {
            return Err(ServerError::BadRequest(
                "state must be one of: opened, closed, all".to_string(),
            ))
        }
    };

    let workspace_codebases = state.codebase_store.list_by_workspace(workspace_id).await?;
    if workspace_codebases.is_empty() {
        return Err(ServerError::NotFound(
            "No codebases linked to this workspace".to_string(),
        ));
    }

    let codebase = match q.codebase_id.as_deref() {
        Some(codebase_id) => workspace_codebases
            .iter()
            .find(|item| item.id == codebase_id)
            .cloned(),
        None => workspace_codebases
            .iter()
            .find(|item| item.is_default)
            .cloned()
            .or_else(|| workspace_codebases.first().cloned()),
    }
    .ok_or_else(|| ServerError::NotFound("Codebase not found in this workspace".to_string()))?;

    let parsed = resolve_gitlab_project_for_codebase(
        codebase.source_url.as_deref(),
        Some(codebase.repo_path.as_str()),
    )
    .ok_or_else(|| {
        ServerError::BadRequest(
            "Selected codebase is not linked to a GitLab repository.".to_string(),
        )
    })?;

    // Resolve host from source URL for self-hosted GitLab support
    let host = codebase
        .source_url
        .as_deref()
        .and_then(parse_gitlab_url)
        .map(|url| url.host)
        .unwrap_or_else(|| "gitlab.com".to_string());

    let board_token = load_board_token(&state, q.board_id.as_deref()).await?;

    let issues = list_gitlab_issues(
        &host,
        &parsed,
        Some(state_filter),
        Some(50),
        board_token.as_deref(),
    )
    .await
    .map_err(ServerError::Internal)?;

    Ok(Json(serde_json::json!({
        "project": parsed,
        "host": host,
        "codebase": {
            "id": codebase.id,
            "label": codebase.label.clone().unwrap_or_else(|| {
                std::path::Path::new(&codebase.repo_path)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or(&codebase.repo_path)
                    .to_string()
            }),
        },
        "issues": issues,
    })))
}

// ─── List merge requests ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MergeRequestQuery {
    workspace_id: Option<String>,
    codebase_id: Option<String>,
    board_id: Option<String>,
    state: Option<String>,
}

async fn list_merge_requests(
    State(state): State<AppState>,
    Query(q): Query<MergeRequestQuery>,
) -> Result<Json<serde_json::Value>, ServerError> {
    let workspace_id = q
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ServerError::BadRequest("workspaceId is required".to_string()))?;

    let state_filter = match q.state.as_deref().unwrap_or("opened") {
        "opened" | "closed" | "merged" | "all" => q.state.as_deref().unwrap_or("opened"),
        _ => {
            return Err(ServerError::BadRequest(
                "state must be one of: opened, closed, merged, all".to_string(),
            ))
        }
    };

    let workspace_codebases = state.codebase_store.list_by_workspace(workspace_id).await?;
    if workspace_codebases.is_empty() {
        return Err(ServerError::NotFound(
            "No codebases linked to this workspace".to_string(),
        ));
    }

    let codebase = match q.codebase_id.as_deref() {
        Some(codebase_id) => workspace_codebases
            .iter()
            .find(|item| item.id == codebase_id)
            .cloned(),
        None => workspace_codebases
            .iter()
            .find(|item| item.is_default)
            .cloned()
            .or_else(|| workspace_codebases.first().cloned()),
    }
    .ok_or_else(|| ServerError::NotFound("Codebase not found in this workspace".to_string()))?;

    let parsed = resolve_gitlab_project_for_codebase(
        codebase.source_url.as_deref(),
        Some(codebase.repo_path.as_str()),
    )
    .ok_or_else(|| {
        ServerError::BadRequest(
            "Selected codebase is not linked to a GitLab repository.".to_string(),
        )
    })?;

    let host = codebase
        .source_url
        .as_deref()
        .and_then(parse_gitlab_url)
        .map(|url| url.host)
        .unwrap_or_else(|| "gitlab.com".to_string());

    let board_token = load_board_token(&state, q.board_id.as_deref()).await?;

    let merge_requests = list_gitlab_merge_requests(
        &host,
        &parsed,
        Some(state_filter),
        Some(50),
        board_token.as_deref(),
    )
    .await
    .map_err(ServerError::Internal)?;

    Ok(Json(serde_json::json!({
        "project": parsed,
        "host": host,
        "codebase": {
            "id": codebase.id,
            "label": codebase.label.clone().unwrap_or_else(|| {
                std::path::Path::new(&codebase.repo_path)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or(&codebase.repo_path)
                    .to_string()
            }),
        },
        "mergeRequests": merge_requests,
    })))
}
