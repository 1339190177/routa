//! Minimal MCP setup for ACP providers in the Rust desktop backend.
//!
//! This currently implements the provider setup required by the KanbanTask
//! Agent flow for OpenCode. It mirrors the Next.js behavior closely enough to
//! expose the Routa MCP server with workspace/session/tool profile context.

use std::path::Path;

use serde_json::{Map, Value};

fn build_mcp_endpoint(
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> String {
    let base_url =
        std::env::var("ROUTA_SERVER_URL").unwrap_or_else(|_| "http://127.0.0.1:3210".to_string());

    let mut params = vec![
        format!("wsId={}", workspace_id),
        format!("sid={}", session_id),
    ];

    if let Some(mode) = tool_mode.filter(|value| *value == "essential" || *value == "full") {
        params.push(format!("toolMode={}", mode));
    }

    if let Some(profile) = mcp_profile.filter(|value| *value == "kanban-planning") {
        params.push(format!("mcpProfile={}", profile));
    }

    format!("{}/api/mcp?{}", base_url, params.join("&"))
}

async fn ensure_mcp_for_opencode(
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> Result<String, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    let config_dir = home_dir.join(".config").join("opencode");
    let config_file = config_dir.join("opencode.json");

    let mut existing: Map<String, Value> = match tokio::fs::read_to_string(&config_file).await {
        Ok(raw) => serde_json::from_str::<Value>(&raw)
            .ok()
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default(),
        Err(_) => Map::new(),
    };

    let mut mcp = existing
        .remove("mcp")
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();

    mcp.insert(
        "routa-coordination".to_string(),
        serde_json::json!({
            "type": "remote",
            "url": build_mcp_endpoint(workspace_id, session_id, tool_mode, mcp_profile),
            "enabled": true
        }),
    );

    existing.insert("mcp".to_string(), Value::Object(mcp));

    tokio::fs::create_dir_all(&config_dir)
        .await
        .map_err(|err| format!("mkdir {}: {}", config_dir.display(), err))?;
    let encoded = serde_json::to_vec_pretty(&Value::Object(existing))
        .map_err(|err| format!("encode OpenCode MCP config: {}", err))?;
    tokio::fs::write(&config_file, encoded)
        .await
        .map_err(|err| format!("write {}: {}", config_file.display(), err))?;

    Ok(format!(
        "opencode: wrote MCP config to {}",
        display_path(&config_file)
    ))
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

pub async fn ensure_mcp_for_provider(
    provider_id: &str,
    workspace_id: &str,
    session_id: &str,
    tool_mode: Option<&str>,
    mcp_profile: Option<&str>,
) -> Result<Option<String>, String> {
    let base_id = provider_id.strip_suffix("-registry").unwrap_or(provider_id);

    match base_id {
        "opencode" => ensure_mcp_for_opencode(workspace_id, session_id, tool_mode, mcp_profile)
            .await
            .map(Some),
        _ => Ok(None),
    }
}
