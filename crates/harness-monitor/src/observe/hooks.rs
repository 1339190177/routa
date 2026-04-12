use crate::observe::ipc;
use crate::observe::repo::{detect_repo_root, resolve, resolve_runtime, RepoContext};
use crate::shared::db::Db;
use crate::shared::models::{
    AttributionConfidence, FileEventRecord, GitEvent, HookClient, HookEvent, RuntimeMessage,
    SessionRecord,
};
use anyhow::{Context, Result};
use chrono::{Datelike, Utc};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

pub fn parse_stdin_payload() -> Result<String> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    Ok(input)
}

pub fn handle_hook(
    client_name: &str,
    event_name: &str,
    repo_hint: Option<&str>,
    db_hint: Option<&str>,
    payload_raw: &str,
) -> Result<()> {
    let payload: Value = if payload_raw.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(payload_raw).context("parse hook payload")?
    };

    let cwd = extract_field(&payload, &["cwd", "workingDir", "working_directory"])
        .or_else(|| repo_hint.map(|r| r.to_string()))
        .unwrap_or_else(|| ".".to_string());
    let ctx = resolve(Some(&cwd), db_hint)?;
    let db = Db::open(&ctx.db_path)?;
    let repo_root = ctx.repo_root.to_string_lossy().to_string();
    let now_ms = Utc::now().timestamp_millis();
    let client = HookClient::from_str(client_name);

    let session_id = extract_field(&payload, &["session_id", "sessionId", "thread_id"])
        .unwrap_or_else(|| "unknown".to_string());
    let turn_id = extract_field(&payload, &["turn_id", "turnId"]);
    let model = extract_field(&payload, &["model"]).filter(|value| !value.is_empty());
    let transcript_path = extract_field(&payload, &["transcript_path", "transcriptPath"]);
    let session_source = extract_field(&payload, &["source"]);
    let prompt = extract_field(&payload, &["prompt"]);
    let hook_event_name = extract_field(
        &payload,
        &[
            "hook_event_name",
            "event_name",
            "hookEventName",
            "eventName",
        ],
    )
    .unwrap_or_else(|| normalize_event_name(client_name, event_name));
    let tool_name = extract_field(&payload, &["tool_name", "toolName"])
        .or_else(|| extract_field_from_cmd_path(&payload));
    let mut task_prompt = prompt.clone();
    let mut task_identity = derive_task_identity(
        &hook_event_name,
        &session_id,
        turn_id.as_deref(),
        task_prompt.as_deref(),
    );
    if task_identity.is_none()
        && db
            .resolve_task_id(&repo_root, Some(&session_id), turn_id.as_deref())?
            .is_none()
    {
        if let Some(recovered_prompt) =
            recover_prompt_from_transcript(turn_id.as_deref(), transcript_path.as_deref())
        {
            task_identity = task_identity_from_prompt(
                &session_id,
                turn_id.as_deref(),
                recovered_prompt.as_str(),
            );
            task_prompt = Some(recovered_prompt);
        }
    }

    let payload_json = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
    let tmux_session = extract_field(&payload, &["tmux_session", "tmuxSession"])
        .or_else(|| std::env::var("TMUX_SESSION").ok());
    let tmux_window = extract_field(&payload, &["tmux_window", "tmuxWindow"])
        .or_else(|| std::env::var("TMUX_WINDOW").ok());
    let tmux_pane = extract_field(&payload, &["tmux_pane", "tmuxPane"])
        .or_else(|| std::env::var("TMUX_PANE").ok());
    let session_display_name = extract_session_display_name(
        &payload,
        transcript_path.as_deref(),
        session_source.as_deref(),
        tmux_session.as_deref(),
        tmux_pane.as_deref(),
    );

    let metadata_json = json!({
        "client_event": event_name,
        "session_started_from": client.as_str(),
        "session_source": session_source,
        "transcript_path": transcript_path,
        "session_display_name": session_display_name,
    })
    .to_string();

    db.upsert_session(&SessionRecord {
        session_id: session_id.clone(),
        repo_root: repo_root.clone(),
        client: client.as_str().to_string(),
        cwd: cwd.clone(),
        model: model.clone(),
        started_at_ms: now_ms,
        last_seen_at_ms: now_ms,
        ended_at_ms: if normalized_is_stop(&hook_event_name) {
            Some(now_ms)
        } else {
            None
        },
        status: if normalized_is_stop(&hook_event_name) {
            "ended".to_string()
        } else {
            "active".to_string()
        },
        tmux_session,
        tmux_window,
        tmux_pane,
        metadata_json,
    })?;

    db.record_turn(
        &session_id,
        &repo_root,
        turn_id.as_deref(),
        client.as_str(),
        &hook_event_name,
        tool_name.as_deref(),
        extract_tool_command(&payload).as_deref(),
        now_ms,
        &payload_json,
    )?;

    if let Some((task_id, task_title, prompt_preview)) = &task_identity {
        let objective = task_prompt.as_deref().unwrap_or(task_title.as_str());
        let _ = db.upsert_task_from_prompt(
            &repo_root,
            &session_id,
            turn_id.as_deref(),
            transcript_path.as_deref(),
            task_id,
            task_title,
            objective,
            Some(prompt_preview.as_str()),
            task_prompt.is_some() && prompt.as_deref() != task_prompt.as_deref(),
            now_ms,
        )?;
    }

    if event_is_file_mutating(&hook_event_name, &client, tool_name.as_deref()) {
        let tool_input = payload
            .get("tool_input")
            .cloned()
            .unwrap_or_else(|| payload.clone());
        let candidate_paths = extract_file_paths(&tool_input, &ctx);
        for rel_path in candidate_paths {
            let abs_path = ctx.repo_root.join(&rel_path);
            let metadata = std::fs::metadata(&abs_path).ok();
            let (mtime_ms, size_bytes) = metadata
                .and_then(|meta| {
                    meta.modified()
                        .ok()
                        .and_then(|ts| ts.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|dur| {
                            (
                                Some(dur.as_millis() as i64),
                                if meta.is_file() {
                                    Some(meta.len() as i64)
                                } else {
                                    None
                                },
                            )
                        })
                })
                .unwrap_or((None, None));
            let task_id = db.resolve_task_id(&repo_root, Some(&session_id), turn_id.as_deref())?;
            let _ = db.insert_file_event(&FileEventRecord {
                id: None,
                repo_root: repo_root.clone(),
                rel_path: rel_path.clone(),
                event_kind: "hook-file".to_string(),
                observed_at_ms: now_ms,
                session_id: Some(session_id.clone()),
                turn_id: turn_id.clone(),
                task_id: task_id.clone(),
                confidence: AttributionConfidence::Exact,
                source: client.as_str().to_string(),
                metadata_json: json!({ "raw_event": hook_event_name }).to_string(),
            })?;
            db.update_file_state(
                &repo_root,
                &rel_path,
                true,
                "modify",
                mtime_ms,
                size_bytes,
                now_ms,
                Some(&session_id),
                turn_id.as_deref(),
                Some(AttributionConfidence::Exact),
                Some(client.as_str()),
            )?;
        }
    }

    let _ = try_forward_hook_to_runtime(client_name, event_name, repo_hint, db_hint, payload_raw)?;

    Ok(())
}

pub fn try_forward_hook_to_runtime(
    client_name: &str,
    event_name: &str,
    repo_hint: Option<&str>,
    db_hint: Option<&str>,
    payload_raw: &str,
) -> Result<bool> {
    let (ctx, message) =
        build_hook_runtime_message(client_name, event_name, repo_hint, db_hint, payload_raw)?;
    if let Err(err) = send_runtime_message(&ctx, &message) {
        eprintln!(
            "harness-monitor warning: runtime transport unavailable, fallback to local store: {err}"
        );
        return Ok(false);
    }

    if let RuntimeMessage::Hook(event) = &message {
        if let Some(git_event_name) = infer_git_refresh_event(event) {
            let git_message = RuntimeMessage::Git(GitEvent {
                repo_root: ctx.repo_root.to_string_lossy().to_string(),
                observed_at_ms: event.observed_at_ms,
                event_name: git_event_name.to_string(),
                args: Vec::new(),
                head_commit: Some(current_head(&ctx.repo_root)?),
                branch: Some(current_branch(&ctx.repo_root)?),
            });
            let _ = send_runtime_message(&ctx, &git_message);
        }
    }

    Ok(true)
}

pub fn build_hook_runtime_message(
    client_name: &str,
    event_name: &str,
    repo_hint: Option<&str>,
    db_hint: Option<&str>,
    payload_raw: &str,
) -> Result<(RepoContext, RuntimeMessage)> {
    let payload: Value = if payload_raw.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(payload_raw).context("parse hook payload")?
    };

    let cwd = extract_field(&payload, &["cwd", "workingDir", "working_directory"])
        .or_else(|| repo_hint.map(|r| r.to_string()))
        .unwrap_or_else(|| ".".to_string());
    let ctx = resolve(Some(&cwd), db_hint)?;
    let now_ms = Utc::now().timestamp_millis();
    let client = HookClient::from_str(client_name);
    let session_id = extract_field(&payload, &["session_id", "sessionId", "thread_id"])
        .unwrap_or_else(|| "unknown".to_string());
    let turn_id = extract_field(&payload, &["turn_id", "turnId"]);
    let model = extract_field(&payload, &["model"]).filter(|value| !value.is_empty());
    let transcript_path = extract_field(&payload, &["transcript_path", "transcriptPath"]);
    let session_source = extract_field(&payload, &["source"]);
    let prompt = extract_field(&payload, &["prompt"]);
    let hook_event_name = extract_field(
        &payload,
        &[
            "hook_event_name",
            "event_name",
            "hookEventName",
            "eventName",
        ],
    )
    .unwrap_or_else(|| normalize_event_name(client_name, event_name));
    let tool_name = extract_field(&payload, &["tool_name", "toolName"])
        .or_else(|| extract_field_from_cmd_path(&payload));
    let mut task_prompt = prompt.clone();
    let mut task_identity = derive_task_identity(
        &hook_event_name,
        &session_id,
        turn_id.as_deref(),
        task_prompt.as_deref(),
    );
    if task_identity.is_none() {
        if let Some(recovered_prompt) =
            recover_prompt_from_transcript(turn_id.as_deref(), transcript_path.as_deref())
        {
            task_identity = task_identity_from_prompt(
                &session_id,
                turn_id.as_deref(),
                recovered_prompt.as_str(),
            );
            task_prompt = Some(recovered_prompt);
        }
    }
    let tool_command = extract_tool_command(&payload);
    let tmux_session = extract_field(&payload, &["tmux_session", "tmuxSession"])
        .or_else(|| std::env::var("TMUX_SESSION").ok());
    let tmux_window = extract_field(&payload, &["tmux_window", "tmuxWindow"])
        .or_else(|| std::env::var("TMUX_WINDOW").ok());
    let tmux_pane = extract_field(&payload, &["tmux_pane", "tmuxPane"])
        .or_else(|| std::env::var("TMUX_PANE").ok());
    let session_display_name = extract_session_display_name(
        &payload,
        transcript_path.as_deref(),
        session_source.as_deref(),
        tmux_session.as_deref(),
        tmux_pane.as_deref(),
    );
    let tool_input = payload
        .get("tool_input")
        .cloned()
        .unwrap_or_else(|| payload.clone());
    let file_paths = if event_is_file_mutating(&hook_event_name, &client, tool_name.as_deref()) {
        extract_file_paths(&tool_input, &ctx)
    } else {
        Vec::new()
    };

    let repo_root = ctx.repo_root.to_string_lossy().to_string();

    Ok((
        ctx,
        RuntimeMessage::Hook(HookEvent {
            repo_root,
            observed_at_ms: now_ms,
            status: None,
            client: client.as_str().to_string(),
            session_id,
            session_display_name,
            turn_id,
            cwd,
            model,
            transcript_path,
            session_source,
            event_name: hook_event_name,
            tool_name,
            tool_command,
            file_paths,
            task_id: task_identity
                .as_ref()
                .map(|(task_id, _, _)| task_id.clone()),
            task_title: task_identity
                .as_ref()
                .map(|(_, task_title, _)| task_title.clone()),
            prompt_preview: task_identity
                .as_ref()
                .map(|(_, _, prompt_preview)| prompt_preview.clone()),
            recovered_from_transcript: task_prompt.is_some() && prompt.as_deref() != task_prompt.as_deref(),
            tmux_session,
            tmux_window,
            tmux_pane,
        }),
    ))
}

pub fn handle_git_event(ctx: &RepoContext, event_name: &str, args: &[String]) -> Result<()> {
    if try_forward_git_event(ctx, event_name, args)? {
        return Ok(());
    }

    let db = Db::open(&ctx.db_path)?;
    let now_ms = Utc::now().timestamp_millis();
    let head = current_head(&ctx.repo_root)?;
    let branch = current_branch(&ctx.repo_root)?;
    let metadata_json = json!({ "args": args }).to_string();

    db.insert_git_event(
        &ctx.repo_root.to_string_lossy(),
        event_name,
        Some(head.as_str()),
        Some(branch.as_str()),
        now_ms,
        &metadata_json,
    )?;

    let _ = crate::observe::poll_repo(
        ctx,
        &db,
        "git-hook",
        crate::shared::models::DEFAULT_INFERENCE_WINDOW_MS,
    )?;
    db.clear_inconsistent_state(&ctx.repo_root.to_string_lossy())?;
    Ok(())
}

struct TranscriptSessionBackfill {
    session_id: String,
    cwd: String,
    model: Option<String>,
    transcript_path: String,
    source: Option<String>,
    last_seen_at_ms: i64,
    status: String,
    turn_id: Option<String>,
    prompt: Option<String>,
    turn_started_at_ms: i64,
    recovered_events: Vec<RuntimeMessage>,
}

#[derive(Clone, Default)]
struct TranscriptTurnBackfill {
    turn_id: Option<String>,
    prompt: Option<String>,
    completed: bool,
    started_at_ms: i64,
    events: Vec<RuntimeMessage>,
}

pub fn bootstrap_codex_transcript_messages(
    repo_root: &std::path::Path,
) -> Result<Vec<RuntimeMessage>> {
    const BACKFILL_WINDOW_MS: i64 = 24 * 60 * 60 * 1000;
    const ACTIVE_WINDOW_MS: i64 = 30 * 60 * 1000;
    const MAX_TRANSCRIPTS: usize = 48;

    let sessions_root = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .map(|home| home.join(".codex").join("sessions"));
    let Some(sessions_root) = sessions_root.filter(|path| path.exists()) else {
        return Ok(Vec::new());
    };

    let now_ms = Utc::now().timestamp_millis();
    let mut transcripts = collect_recent_transcripts(&sessions_root)?;
    transcripts.retain(|(_, modified_ms)| now_ms.saturating_sub(*modified_ms) <= BACKFILL_WINDOW_MS);
    transcripts.sort_by(|a, b| b.1.cmp(&a.1));
    transcripts.truncate(MAX_TRANSCRIPTS);

    let repo_root_text = repo_root.to_string_lossy().to_string();
    let mut messages = Vec::new();
    for (path, modified_ms) in transcripts {
        let Some(summary) = parse_transcript_backfill(&path, modified_ms, repo_root) else {
            continue;
        };
        if summary.cwd != repo_root_text {
            continue;
        }
        if summary.status != "active" && now_ms.saturating_sub(summary.last_seen_at_ms) > ACTIVE_WINDOW_MS
        {
            continue;
        }

        let task_identity = summary
            .prompt
            .as_deref()
            .and_then(|prompt| task_identity_from_prompt(&summary.session_id, summary.turn_id.as_deref(), prompt));
        let session_display_name = transcript_display_name(&summary.transcript_path);
        messages.push(RuntimeMessage::Hook(HookEvent {
            repo_root: repo_root_text.clone(),
            observed_at_ms: summary.turn_started_at_ms,
            status: Some(summary.status),
            client: "codex".to_string(),
            session_id: summary.session_id,
            session_display_name,
            turn_id: summary.turn_id,
            cwd: summary.cwd,
            model: summary.model,
            transcript_path: Some(summary.transcript_path),
            session_source: summary.source,
            event_name: "TranscriptRecover".to_string(),
            tool_name: None,
            tool_command: None,
            file_paths: Vec::new(),
            task_id: task_identity.as_ref().map(|(task_id, _, _)| task_id.clone()),
            task_title: task_identity.as_ref().map(|(_, title, _)| title.clone()),
            prompt_preview: task_identity
                .as_ref()
                .map(|(_, _, preview)| preview.clone()),
            recovered_from_transcript: true,
            tmux_session: None,
            tmux_window: None,
            tmux_pane: None,
        }));
        messages.extend(summary.recovered_events);
    }

    messages.sort_by_key(RuntimeMessage::observed_at_ms);
    Ok(messages)
}

pub fn try_forward_git_event(ctx: &RepoContext, event_name: &str, args: &[String]) -> Result<bool> {
    let message = RuntimeMessage::Git(GitEvent {
        repo_root: ctx.repo_root.to_string_lossy().to_string(),
        observed_at_ms: Utc::now().timestamp_millis(),
        event_name: event_name.to_string(),
        args: args.to_vec(),
        head_commit: Some(current_head(&ctx.repo_root)?),
        branch: Some(current_branch(&ctx.repo_root)?),
    });
    match send_runtime_message(ctx, &message) {
        Ok(_) => Ok(true),
        Err(err) => {
            eprintln!(
                "harness-monitor warning: runtime transport unavailable, fallback to local store: {err}"
            );
            Ok(false)
        }
    }
}

fn send_runtime_message(ctx: &RepoContext, message: &RuntimeMessage) -> Result<()> {
    ipc::send_socket_message(&ctx.runtime_socket_path, message)
        .or_else(|_| ipc::send_tcp_message(&ctx.runtime_tcp_addr, message))
        .or_else(|_| ipc::send_message(&ctx.runtime_event_path, message))
}

fn extract_tool_command(payload: &Value) -> Option<String> {
    payload
        .get("tool_input")
        .and_then(|it| it.get("command"))
        .and_then(|it| it.as_str())
        .map(ToString::to_string)
}

fn extract_field(payload: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = payload.get(key).and_then(Value::as_str) {
            return Some(value.to_string());
        }
        if let Some(inner) = payload
            .get("tool_input")
            .and_then(|v| v.get(key))
            .and_then(Value::as_str)
        {
            return Some(inner.to_string());
        }
    }
    None
}

fn extract_field_from_cmd_path(payload: &Value) -> Option<String> {
    payload
        .get("command")
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn extract_session_display_name(
    payload: &Value,
    transcript_path: Option<&str>,
    session_source: Option<&str>,
    tmux_session: Option<&str>,
    tmux_pane: Option<&str>,
) -> Option<String> {
    extract_field(
        payload,
        &[
            "session_name",
            "sessionName",
            "name",
            "pane_title",
            "paneTitle",
            "title",
        ],
    )
    .filter(|value| !value.trim().is_empty())
    .or_else(|| std::env::var("TMUX_PANE_TITLE").ok())
    .filter(|value| !value.trim().is_empty())
    .or_else(|| {
        transcript_path
            .and_then(transcript_display_name)
            .filter(|value| !value.trim().is_empty())
    })
    .or_else(|| {
        tmux_session.map(|session| match tmux_pane {
            Some(pane) if !pane.is_empty() => format!("{session} {pane}"),
            _ => session.to_string(),
        })
    })
    .or_else(|| session_source.map(|source| format!("codex {source}")))
}

fn transcript_display_name(path: &str) -> Option<String> {
    let file_name = Path::new(path).file_stem()?.to_string_lossy().to_string();
    let normalized = file_name
        .trim()
        .trim_end_matches(".json")
        .trim_end_matches(".jsonl")
        .trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn derive_task_identity(
    hook_event_name: &str,
    session_id: &str,
    turn_id: Option<&str>,
    prompt: Option<&str>,
) -> Option<(String, String, String)> {
    if hook_event_name != "UserPromptSubmit" {
        return None;
    }
    task_identity_from_prompt(session_id, turn_id, prompt?)
}

fn task_identity_from_prompt(
    session_id: &str,
    turn_id: Option<&str>,
    prompt: &str,
) -> Option<(String, String, String)> {
    let turn_id = turn_id?.trim();
    if turn_id.is_empty() {
        return None;
    }
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return None;
    }
    let task_id = format!("task:{session_id}:{turn_id}");
    let title = summarize_prompt_title(prompt);
    let prompt_preview = summarize_prompt_preview(prompt);
    Some((task_id, title, prompt_preview))
}

fn recover_prompt_from_transcript(
    turn_id: Option<&str>,
    transcript_path: Option<&str>,
) -> Option<String> {
    let turn_id = turn_id?.trim();
    let transcript_path = transcript_path?.trim();
    if turn_id.is_empty() || transcript_path.is_empty() {
        return None;
    }

    let file = std::fs::File::open(transcript_path).ok()?;
    let reader = BufReader::new(file);
    let mut matched_turn = false;
    let mut latest_user_prompt = None;

    for line in reader.lines() {
        let line = line.ok()?;
        let entry: Value = serde_json::from_str(&line).ok()?;
        let entry_type = entry.get("type").and_then(Value::as_str);

        if entry_type == Some("event_msg") {
            match entry.pointer("/payload/type").and_then(Value::as_str) {
                Some("task_started") => {
                    matched_turn =
                        entry.pointer("/payload/turn_id").and_then(Value::as_str) == Some(turn_id);
                    continue;
                }
                Some("user_message") if matched_turn => {
                    if let Some(message) = entry.pointer("/payload/message").and_then(Value::as_str)
                    {
                        let message = message.trim();
                        if !message.is_empty() {
                            latest_user_prompt = Some(message.to_string());
                        }
                    }
                }
                Some("task_complete") if matched_turn => break,
                _ => {}
            }
        }

        if matched_turn
            && entry_type == Some("response_item")
            && entry.pointer("/payload/type").and_then(Value::as_str) == Some("message")
            && entry.pointer("/payload/role").and_then(Value::as_str) == Some("user")
        {
            if let Some(message) = extract_user_prompt_from_response_item(&entry) {
                latest_user_prompt = Some(message);
            }
        }
    }

    latest_user_prompt
}

fn extract_user_prompt_from_response_item(entry: &Value) -> Option<String> {
    let items = entry.pointer("/payload/content")?.as_array()?;
    let mut parts = Vec::new();
    for item in items {
        if item.get("type").and_then(Value::as_str) != Some("input_text") {
            continue;
        }
        let Some(text) = item.get("text").and_then(Value::as_str) else {
            continue;
        };
        let text = text.trim();
        if !text.is_empty() {
            parts.push(text.to_string());
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn summarize_prompt_title(prompt: &str) -> String {
    let first_non_empty = prompt
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(prompt)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    truncate_text(&first_non_empty, 72)
}

fn summarize_prompt_preview(prompt: &str) -> String {
    let normalized = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_text(&normalized, 180)
}

fn truncate_text(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (index, ch) in text.chars().enumerate() {
        if index >= max_chars {
            out.push_str("...");
            break;
        }
        out.push(ch);
    }
    out
}

fn event_is_file_mutating(event: &str, client: &HookClient, tool_name: Option<&str>) -> bool {
    if matches!(event, "Edit" | "edit" | "Write" | "write") {
        return true;
    }

    if matches!(
        event,
        "PostToolUse" | "post-tool-use" | "PreToolUse" | "pre-tool-use"
    ) {
        return match client {
            HookClient::Claude | HookClient::Codex => is_edit_like_tool(tool_name),
            HookClient::Cursor
            | HookClient::Aider
            | HookClient::Gemini
            | HookClient::Copilot
            | HookClient::Qoder
            | HookClient::Auggie
            | HookClient::Kiro => is_edit_like_tool(tool_name),
            HookClient::Unknown => false,
        };
    }

    false
}

fn is_edit_like_tool(tool_name: Option<&str>) -> bool {
    tool_name
        .is_some_and(|name| name.eq_ignore_ascii_case("edit") || name.eq_ignore_ascii_case("write"))
}

fn normalized_is_stop(event: &str) -> bool {
    matches!(
        event,
        "Stop" | "stop" | "SessionStop" | "session-stop" | "exit" | "quit"
    )
}

fn normalize_event_name(_client: &str, event: &str) -> String {
    let normalized = event.trim().to_ascii_lowercase().replace(['_', ' '], "-");

    match normalized.as_str() {
        "session-start" | "sessionstart" => "SessionStart".to_string(),
        "pre-tool-use" | "pretooluse" => "PreToolUse".to_string(),
        "post-tool-use" | "posttooluse" => "PostToolUse".to_string(),
        "user-prompt-submit" | "prompt-submit" | "promptsubmit" => "UserPromptSubmit".to_string(),
        "stop" => "Stop".to_string(),
        "edit" => "Edit".to_string(),
        "write" => "Write".to_string(),
        _ => event.to_string(),
    }
}

fn infer_git_refresh_event(event: &HookEvent) -> Option<&'static str> {
    if !matches!(event.event_name.as_str(), "PostToolUse" | "post-tool-use") {
        return None;
    }
    if !event
        .tool_name
        .as_deref()
        .is_some_and(|name| name.eq_ignore_ascii_case("bash"))
    {
        return None;
    }

    let command = event.tool_command.as_deref()?.trim();
    let command = command.strip_prefix("git ")?;

    if command.starts_with("add ") || command == "add" {
        Some("git-add")
    } else if command.starts_with("commit ") || command == "commit" {
        Some("git-commit")
    } else if command.starts_with("reset ") || command == "reset" {
        Some("git-reset")
    } else if command.starts_with("restore ") || command == "restore" {
        Some("git-restore")
    } else if command.starts_with("checkout ") || command == "checkout" {
        Some("git-checkout")
    } else if command.starts_with("rm ") || command == "rm" {
        Some("git-rm")
    } else if command.starts_with("stash ") || command == "stash" {
        Some("git-stash")
    } else {
        None
    }
}

fn extract_file_paths(tool_input: &Value, ctx: &RepoContext) -> Vec<String> {
    extract_file_paths_for_repo(tool_input, &ctx.repo_root)
}

fn extract_file_paths_for_repo(tool_input: &Value, repo_root: &std::path::Path) -> Vec<String> {
    let mut candidates = HashSet::new();
    collect_file_values(tool_input, &mut candidates);
    if let Some(command) = tool_input.get("command").and_then(Value::as_str) {
        for path in parse_patch_block(command) {
            candidates.insert(path);
        }
        for path in parse_command_paths(command) {
            candidates.insert(path);
        }
    }
    candidates
        .into_iter()
        .filter_map(|value| normalize_repo_relative(repo_root, &value))
        .collect()
}

fn collect_file_values(value: &Value, out: &mut HashSet<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let key_lower = key.to_lowercase();
                let is_path_key = matches!(
                    key_lower.as_str(),
                    "path"
                        | "paths"
                        | "file"
                        | "filepath"
                        | "file_path"
                        | "filename"
                        | "target"
                        | "source"
                        | "target_file"
                        | "source_file"
                        | "absolute_path"
                        | "relative_path"
                );
                if is_path_key {
                    match child {
                        Value::String(path) => {
                            out.insert(path.to_string());
                        }
                        Value::Array(values) => {
                            for item in values {
                                if let Some(path) = item.as_str() {
                                    out.insert(path.to_string());
                                }
                            }
                        }
                        _ => {}
                    }
                }

                collect_file_values(child, out);
            }
        }
        Value::Array(values) => {
            for item in values {
                collect_file_values(item, out);
            }
        }
        Value::String(text) => {
            for value in parse_patch_block(text) {
                out.insert(value);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

fn parse_patch_block(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("*** Update File:") {
            out.push(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("*** Add File:") {
            out.push(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("*** Delete File:") {
            out.push(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("*** Move to:") {
            out.push(rest.trim().to_string());
        }
    }
    out
}

fn parse_command_paths(command: &str) -> Vec<String> {
    let tokens = shell_like_split(command);
    if tokens.is_empty() {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    if let Some(separator_index) = tokens.iter().position(|token| token == "--") {
        candidates.extend(
            tokens[separator_index + 1..]
                .iter()
                .filter(|token| !token.starts_with('-'))
                .cloned(),
        );
    } else if tokens.first().is_some_and(|token| token == "git")
        && tokens
            .get(1)
            .is_some_and(|subcommand| matches!(subcommand.as_str(), "add" | "rm"))
    {
        candidates.extend(
            tokens[2..]
                .iter()
                .filter(|token| !token.starts_with('-'))
                .cloned(),
        );
    }

    candidates
}

fn shell_like_split(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote = None;

    for ch in command.chars() {
        match quote {
            Some(active_quote) if ch == active_quote => quote = None,
            Some(_) => current.push(ch),
            None if ch == '\'' || ch == '"' => quote = Some(ch),
            None if ch.is_whitespace() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            None => current.push(ch),
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn normalize_repo_relative(repo_root: &std::path::Path, value: &str) -> Option<String> {
    let clean = value.trim().trim_matches('"').replace('\\', "/");
    if clean.is_empty() || clean == "/dev/null" {
        return None;
    }

    let path = if std::path::Path::new(&clean).is_absolute() {
        std::path::PathBuf::from(clean)
    } else {
        repo_root.join(clean)
    };

    path.strip_prefix(repo_root)
        .ok()
        .map(|v| v.to_string_lossy().replace('\\', "/"))
}

fn current_head(repo_root: &std::path::Path) -> Result<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("rev-parse")
        .arg("HEAD")
        .output()?;
    if !output.status.success() {
        return Ok("unknown".to_string());
    }
    Ok(String::from_utf8(output.stdout)
        .unwrap_or_else(|_| "unknown".to_string())
        .trim()
        .to_string())
}

fn current_branch(repo_root: &std::path::Path) -> Result<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output()?;
    if !output.status.success() {
        return Ok("unknown".to_string());
    }
    Ok(String::from_utf8(output.stdout)
        .unwrap_or_else(|_| "unknown".to_string())
        .trim()
        .to_string())
}

fn collect_recent_transcripts(root: &std::path::Path) -> Result<Vec<(std::path::PathBuf, i64)>> {
    let mut stack = recent_transcript_dirs(root);
    let mut files = Vec::new();
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if !file_type.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }
            let modified_ms = entry
                .metadata()
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|dur| dur.as_millis() as i64)
                .unwrap_or_default();
            files.push((path, modified_ms));
        }
    }
    Ok(files)
}

fn recent_transcript_dirs(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let today = chrono::Local::now().date_naive();
    let yesterday = today.pred_opt();
    [Some(today), yesterday]
        .into_iter()
        .flatten()
        .map(|date| {
            root.join(format!("{:04}", date.year()))
                .join(format!("{:02}", date.month()))
                .join(format!("{:02}", date.day()))
        })
        .filter(|path| path.exists())
        .collect()
}

fn parse_transcript_backfill(
    transcript_path: &std::path::Path,
    modified_ms: i64,
    repo_root: &std::path::Path,
) -> Option<TranscriptSessionBackfill> {
    let file = std::fs::File::open(transcript_path).ok()?;
    let reader = BufReader::new(file);
    let mut session_id = None;
    let mut cwd = None;
    let mut model = None;
    let mut source = None;
    let mut last_seen_at_ms = modified_ms;
    let mut current_turn = TranscriptTurnBackfill::default();
    let mut latest_turn = TranscriptTurnBackfill::default();

    for line in reader.lines() {
        let line = line.ok()?;
        let entry: Value = serde_json::from_str(&line).ok()?;
        let observed_at_ms = entry
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_rfc3339_ms)
            .unwrap_or(last_seen_at_ms);
        last_seen_at_ms = observed_at_ms;

        match entry.get("type").and_then(Value::as_str) {
            Some("session_meta") => {
                session_id = entry.pointer("/payload/id").and_then(Value::as_str).map(str::to_string);
                cwd = entry.pointer("/payload/cwd").and_then(Value::as_str).map(str::to_string);
                model = entry
                    .pointer("/payload/model")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| {
                        entry.pointer("/payload/model_provider").and_then(Value::as_str).map(str::to_string)
                    });
                source = entry.pointer("/payload/source").and_then(Value::as_str).map(str::to_string);
            }
            Some("event_msg") => match entry.pointer("/payload/type").and_then(Value::as_str) {
                Some("task_started") => {
                    if current_turn.turn_id.is_some() {
                        latest_turn = std::mem::take(&mut current_turn);
                    }
                    current_turn.turn_id =
                        entry.pointer("/payload/turn_id").and_then(Value::as_str).map(str::to_string);
                    current_turn.prompt = None;
                    current_turn.completed = false;
                    current_turn.started_at_ms = observed_at_ms;
                }
                Some("user_message") if current_turn.turn_id.is_some() => {
                    current_turn.prompt =
                        entry.pointer("/payload/message").and_then(Value::as_str).map(str::to_string);
                }
                Some("task_complete") => {
                    if entry.pointer("/payload/turn_id").and_then(Value::as_str)
                        == current_turn.turn_id.as_deref()
                    {
                        current_turn.completed = true;
                    }
                }
                _ => {}
            },
            Some("response_item")
                if entry.pointer("/payload/type").and_then(Value::as_str) == Some("message")
                    && entry.pointer("/payload/role").and_then(Value::as_str) == Some("user")
                    && current_turn.turn_id.is_some() =>
            {
                if let Some(message) = extract_user_prompt_from_response_item(&entry) {
                    current_turn.prompt = Some(message);
                }
            }
            Some("response_item")
                if entry.pointer("/payload/type").and_then(Value::as_str) == Some("function_call")
                    && current_turn.turn_id.is_some() =>
            {
                if let Some(runtime_messages) = recover_runtime_messages_from_transcript_tool_call(
                    &entry,
                    repo_root,
                    session_id.as_deref(),
                    cwd.as_deref(),
                    model.as_deref(),
                    source.as_deref(),
                    transcript_path,
                    current_turn.turn_id.as_deref(),
                    current_turn.prompt.as_deref(),
                    observed_at_ms,
                ) {
                    current_turn.events.extend(runtime_messages);
                }
            }
            _ => {}
        }
    }

    let use_current_turn = current_turn.turn_id.is_some();
    let selected_turn = if use_current_turn { current_turn } else { latest_turn };

    let turn_started_at_ms = if selected_turn.started_at_ms > 0 {
        selected_turn.started_at_ms
    } else {
        last_seen_at_ms
    };

    Some(TranscriptSessionBackfill {
        session_id: session_id?,
        cwd: cwd?,
        model,
        transcript_path: transcript_path.to_string_lossy().to_string(),
        source,
        last_seen_at_ms,
        status: if selected_turn.completed {
            "idle".to_string()
        } else {
            "active".to_string()
        },
        turn_id: selected_turn.turn_id,
        prompt: selected_turn.prompt,
        turn_started_at_ms,
        recovered_events: selected_turn.events,
    })
}

fn parse_rfc3339_ms(timestamp: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|parsed| parsed.timestamp_millis())
}

#[allow(clippy::too_many_arguments)]
fn recover_runtime_messages_from_transcript_tool_call(
    entry: &Value,
    repo_root: &std::path::Path,
    session_id: Option<&str>,
    cwd: Option<&str>,
    model: Option<&str>,
    source: Option<&str>,
    transcript_path: &std::path::Path,
    turn_id: Option<&str>,
    prompt: Option<&str>,
    observed_at_ms: i64,
) -> Option<Vec<RuntimeMessage>> {
    let session_id = session_id?.to_string();
    let cwd = cwd?.to_string();
    let tool_name = entry.pointer("/payload/name").and_then(Value::as_str)?;
    let arguments = entry
        .pointer("/payload/arguments")
        .and_then(Value::as_str)
        .unwrap_or("");
    let task_identity = prompt.and_then(|text| task_identity_from_prompt(&session_id, turn_id, text));
    let session_display_name =
        transcript_display_name(transcript_path.to_string_lossy().as_ref());
    let transcript_text = transcript_path.to_string_lossy().to_string();

    match tool_name {
        "exec_command" => {
            let payload: Value = serde_json::from_str(arguments).ok()?;
            let workdir = payload
                .get("workdir")
                .and_then(Value::as_str)
                .map(std::path::PathBuf::from);
            if workdir
                .as_deref()
                .is_some_and(|path| {
                    detect_repo_root(path)
                        .map(|root| root != repo_root)
                        .unwrap_or_else(|_| !path.starts_with(repo_root))
                })
            {
                return None;
            }

            let command = payload
                .get("cmd")
                .or_else(|| payload.get("command"))
                .and_then(Value::as_str)?
                .to_string();
            let tool_input = json!({ "command": command });
            let file_paths = extract_file_paths_for_repo(&tool_input, repo_root);
            let hook = RuntimeMessage::Hook(HookEvent {
                repo_root: repo_root.to_string_lossy().to_string(),
                observed_at_ms,
                status: None,
                client: "codex".to_string(),
                session_id: session_id.clone(),
                session_display_name: session_display_name.clone(),
                turn_id: turn_id.map(str::to_string),
                cwd,
                model: model.map(str::to_string),
                transcript_path: Some(transcript_text),
                session_source: source.map(str::to_string),
                event_name: "PostToolUse".to_string(),
                tool_name: Some("Bash".to_string()),
                tool_command: Some(command.clone()),
                file_paths,
                task_id: task_identity.as_ref().map(|(task_id, _, _)| task_id.clone()),
                task_title: task_identity.as_ref().map(|(_, title, _)| title.clone()),
                prompt_preview: task_identity
                    .as_ref()
                    .map(|(_, _, prompt_preview)| prompt_preview.clone()),
                recovered_from_transcript: true,
                tmux_session: None,
                tmux_window: None,
                tmux_pane: None,
            });

            let mut messages = vec![hook];
            if let RuntimeMessage::Hook(hook_event) = messages[0].clone() {
                if let Some(git_event_name) = infer_git_refresh_event(&hook_event) {
                    messages.push(RuntimeMessage::Git(GitEvent {
                        repo_root: repo_root.to_string_lossy().to_string(),
                        observed_at_ms,
                        event_name: git_event_name.to_string(),
                        args: Vec::new(),
                        head_commit: None,
                        branch: None,
                    }));
                }
            }
            Some(messages)
        }
        "apply_patch" => {
            let tool_input = json!({ "command": arguments });
            let file_paths = extract_file_paths_for_repo(&tool_input, repo_root);
            if file_paths.is_empty() {
                return None;
            }
            Some(vec![RuntimeMessage::Hook(HookEvent {
                repo_root: repo_root.to_string_lossy().to_string(),
                observed_at_ms,
                status: None,
                client: "codex".to_string(),
                session_id,
                session_display_name,
                turn_id: turn_id.map(str::to_string),
                cwd,
                model: model.map(str::to_string),
                transcript_path: Some(transcript_text),
                session_source: source.map(str::to_string),
                event_name: "PostToolUse".to_string(),
                tool_name: Some("Write".to_string()),
                tool_command: None,
                file_paths,
                task_id: task_identity.as_ref().map(|(task_id, _, _)| task_id.clone()),
                task_title: task_identity.as_ref().map(|(_, title, _)| title.clone()),
                prompt_preview: task_identity
                    .as_ref()
                    .map(|(_, _, prompt_preview)| prompt_preview.clone()),
                recovered_from_transcript: true,
                tmux_session: None,
                tmux_window: None,
                tmux_pane: None,
            })])
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn normalize_event_name_handles_edit_write_and_tool_events() {
        assert_eq!(
            normalize_event_name("codex", "session-start"),
            "SessionStart"
        );
        assert_eq!(normalize_event_name("codex", "pre_tool_use"), "PreToolUse");
        assert_eq!(normalize_event_name("codex", "posttooluse"), "PostToolUse");
        assert_eq!(normalize_event_name("codex", "edit"), "Edit");
        assert_eq!(normalize_event_name("codex", "Write"), "Write");
    }

    #[test]
    fn file_mutating_events_detect_tool_intent_for_claude() {
        assert!(event_is_file_mutating(
            "PreToolUse",
            &HookClient::Claude,
            Some("Edit")
        ));
        assert!(event_is_file_mutating(
            "PostToolUse",
            &HookClient::Claude,
            Some("Write")
        ));
        assert!(!event_is_file_mutating(
            "PreToolUse",
            &HookClient::Claude,
            Some("Bash")
        ));
        assert!(!event_is_file_mutating(
            "PostToolUse",
            &HookClient::Claude,
            Some("Read")
        ));
    }

    #[test]
    fn file_mutating_events_do_not_mark_codex_reads_as_writes() {
        assert!(event_is_file_mutating(
            "PreToolUse",
            &HookClient::Codex,
            Some("Edit")
        ));
        assert!(event_is_file_mutating(
            "PostToolUse",
            &HookClient::Codex,
            Some("Write")
        ));
        assert!(!event_is_file_mutating(
            "PreToolUse",
            &HookClient::Codex,
            Some("Read")
        ));
        assert!(!event_is_file_mutating(
            "PostToolUse",
            &HookClient::Codex,
            Some("Grep")
        ));
    }

    #[test]
    fn collect_file_values_supports_file_path_aliases() {
        let mut candidate = HashSet::new();
        let payload = json!({
            "tool_input": {
                "file_path": "src/main.rs",
                "filepath": "src/lib.rs",
                "target_file": "src/target.rs",
            }
        });

        collect_file_values(&payload, &mut candidate);

        assert!(candidate.contains("src/main.rs"));
        assert!(candidate.contains("src/lib.rs"));
        assert!(candidate.contains("src/target.rs"));
    }

    #[test]
    fn session_display_name_prefers_transcript_file_stem() {
        let payload = json!({});

        let display = extract_session_display_name(
            &payload,
            Some("/tmp/transcripts/review-check.jsonl"),
            Some("startup"),
            None,
            None,
        );

        assert_eq!(display.as_deref(), Some("review-check"));
    }

    #[test]
    fn recover_prompt_from_transcript_uses_matching_turn_user_message() {
        let dir = tempdir().expect("tempdir");
        let transcript = dir.path().join("session.jsonl");
        std::fs::write(
            &transcript,
            concat!(
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn-1\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"first task\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn-1\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn-2\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"second task\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn-2\"}}\n"
            ),
        )
        .expect("write transcript");

        let prompt = recover_prompt_from_transcript(Some("turn-2"), transcript.to_str());

        assert_eq!(prompt.as_deref(), Some("second task"));
    }

    #[test]
    fn recover_prompt_from_transcript_falls_back_to_response_item_user_text() {
        let dir = tempdir().expect("tempdir");
        let transcript = dir.path().join("session.jsonl");
        std::fs::write(
            &transcript,
            concat!(
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"turn_id\":\"turn-3\"}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"recover from response item\"}]}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn-3\"}}\n"
            ),
        )
        .expect("write transcript");

        let prompt = recover_prompt_from_transcript(Some("turn-3"), transcript.to_str());

        assert_eq!(prompt.as_deref(), Some("recover from response item"));
    }

    #[test]
    fn parse_command_paths_extracts_git_paths_after_separator() {
        let paths = parse_command_paths(
            "git add -- 'src/app/page.tsx' 'docs/design-docs/example.md'",
        );

        assert_eq!(
            paths,
            vec![
                "src/app/page.tsx".to_string(),
                "docs/design-docs/example.md".to_string()
            ]
        );
    }

    #[test]
    fn parse_transcript_backfill_recovers_latest_turn_tool_events() {
        let dir = tempdir().expect("tempdir");
        let repo_root = dir.path().join("repo");
        std::fs::create_dir_all(repo_root.join("src/app")).expect("create repo");
        let transcript = dir.path().join("session.jsonl");
        let repo_root_text = repo_root.to_string_lossy();
        let payload = format!(
            concat!(
                "{{\"timestamp\":\"2026-04-12T10:00:00Z\",\"type\":\"session_meta\",\"payload\":{{\"id\":\"sess-1\",\"cwd\":\"{repo}\"}}}}\n",
                "{{\"timestamp\":\"2026-04-12T10:00:01Z\",\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_started\",\"turn_id\":\"turn-9\"}}}}\n",
                "{{\"timestamp\":\"2026-04-12T10:00:02Z\",\"type\":\"event_msg\",\"payload\":{{\"type\":\"user_message\",\"message\":\"refresh the page snapshot\"}}}}\n",
                "{{\"timestamp\":\"2026-04-12T10:00:03Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"function_call\",\"name\":\"exec_command\",\"arguments\":\"{{\\\"cmd\\\":\\\"git add -- 'src/app/page.tsx'\\\",\\\"workdir\\\":\\\"{repo}\\\"}}\"}}}}\n",
                "{{\"timestamp\":\"2026-04-12T10:00:04Z\",\"type\":\"response_item\",\"payload\":{{\"type\":\"function_call\",\"name\":\"exec_command\",\"arguments\":\"{{\\\"cmd\\\":\\\"git commit -m \\\\\\\"snapshot refresh\\\\\\\"\\\",\\\"workdir\\\":\\\"{repo}\\\"}}\"}}}}\n"
            ),
            repo = repo_root_text
        );
        std::fs::write(
            &transcript,
            payload,
        )
        .expect("write transcript");

        let summary =
            parse_transcript_backfill(&transcript, 0, &repo_root).expect("parse transcript");

        assert_eq!(summary.turn_id.as_deref(), Some("turn-9"));
        assert_eq!(summary.prompt.as_deref(), Some("refresh the page snapshot"));
        assert_eq!(summary.recovered_events.len(), 4);
    }
}
