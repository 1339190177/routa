use crate::ipc::RuntimeFeed;
use crate::models::{DEFAULT_INFERENCE_WINDOW_MS, DEFAULT_TUI_POLL_MS};
use crate::observe;
use crate::repo::RepoContext;
use crate::state::{DetailMode, EventLogFilter, RuntimeState, ThemeMode};
use anyhow::{Context, Result};
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::style::Color;
use ratatui::text::{Span, Text};
use ratatui::{DefaultTerminal, Frame};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::io::stdout;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::LazyLock;
use std::thread;
use std::time::{Duration, Instant};
use syntect::highlighting::{Theme, ThemeSet};
use syntect::parsing::SyntaxSet;

static SYNTAX_SET: LazyLock<SyntaxSet> = LazyLock::new(SyntaxSet::load_defaults_newlines);
static LIGHT_THEME: LazyLock<Theme> = LazyLock::new(|| {
    let themes = ThemeSet::load_defaults();
    themes
        .themes
        .get("InspiredGitHub")
        .cloned()
        .or_else(|| themes.themes.values().next().cloned())
        .expect("at least one syntax theme")
});
static DARK_THEME: LazyLock<Theme> = LazyLock::new(|| {
    let themes = ThemeSet::load_defaults();
    themes
        .themes
        .get("base16-ocean.dark")
        .cloned()
        .or_else(|| themes.themes.get("base16-eighties.dark").cloned())
        .or_else(|| themes.themes.values().next().cloned())
        .expect("at least one syntax theme")
});

const ACTIVE: Color = Color::Rgb(102, 187, 106);
const INFERRED: Color = Color::Rgb(212, 181, 93);
const STOPPED: Color = Color::Rgb(201, 96, 87);
const IDLE: Color = Color::Rgb(122, 132, 143);

#[derive(Clone, Debug, Default)]
struct DiffStatSummary {
    status: String,
    additions: Option<usize>,
    deletions: Option<usize>,
}

#[derive(Clone, Debug)]
struct DetailCacheEntry {
    key: String,
    text: String,
}

#[derive(Debug)]
enum BackgroundCommand {
    RefreshStats {
        repo_root: String,
        files: Vec<(String, String, i64)>,
    },
    LoadDetail {
        repo_root: String,
        rel_path: String,
        state_code: String,
        version: i64,
        mode: DetailMode,
    },
}

#[derive(Debug)]
enum BackgroundResult {
    Stats {
        entries: Vec<(String, DiffStatSummary)>,
    },
    Detail {
        entry: DetailCacheEntry,
        mode: DetailMode,
    },
}

struct AppCache {
    diff_stats: BTreeMap<String, DiffStatSummary>,
    preview_cache: BTreeMap<String, DetailCacheEntry>,
    diff_cache: BTreeMap<String, DetailCacheEntry>,
    pending_stats_signature: Option<String>,
    pending_preview_key: Option<String>,
    pending_diff_key: Option<String>,
    worker_tx: Sender<BackgroundCommand>,
    worker_rx: Receiver<BackgroundResult>,
}

impl AppCache {
    fn new() -> Self {
        let (worker_tx, worker_rx_cmd) = mpsc::channel();
        let (result_tx, worker_rx) = mpsc::channel();
        thread::spawn(move || background_worker(worker_rx_cmd, result_tx));
        Self {
            diff_stats: BTreeMap::new(),
            preview_cache: BTreeMap::new(),
            diff_cache: BTreeMap::new(),
            pending_stats_signature: None,
            pending_preview_key: None,
            pending_diff_key: None,
            worker_tx,
            worker_rx,
        }
    }

    fn sync_results(&mut self) {
        while let Ok(result) = self.worker_rx.try_recv() {
            match result {
                BackgroundResult::Stats { entries } => {
                    self.diff_stats.extend(entries);
                    self.pending_stats_signature = None;
                }
                BackgroundResult::Detail { entry, mode } => match mode {
                    DetailMode::File => {
                        self.preview_cache.insert(entry.key.clone(), entry);
                        self.pending_preview_key = None;
                    }
                    DetailMode::Summary | DetailMode::Diff => {
                        self.diff_cache.insert(entry.key.clone(), entry);
                        self.pending_diff_key = None;
                    }
                },
            }
        }
    }

    fn warm_visible_files(&mut self, state: &RuntimeState) {
        let files: Vec<(String, String, i64)> = state
            .file_items()
            .iter()
            .take(24)
            .map(|file| {
                (
                    file.rel_path.clone(),
                    file.state_code.clone(),
                    file.last_modified_at_ms,
                )
            })
            .collect();
        if files.is_empty() {
            self.pending_stats_signature = None;
            return;
        }
        let signature = files
            .iter()
            .map(|(path, code, version)| format!("{path}:{code}:{version}"))
            .collect::<Vec<_>>()
            .join("|");
        if self.pending_stats_signature.as_deref() == Some(signature.as_str()) {
            return;
        }
        let _ = self.worker_tx.send(BackgroundCommand::RefreshStats {
            repo_root: state.repo_root.clone(),
            files,
        });
        self.pending_stats_signature = Some(signature);
    }

    fn warm_selected_detail(&mut self, state: &RuntimeState) {
        let Some(file) = state.selected_file() else {
            self.pending_preview_key = None;
            self.pending_diff_key = None;
            return;
        };
        let preview_key = detail_cache_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
            DetailMode::File,
        );
        if !self.preview_cache.contains_key(&preview_key)
            && self.pending_preview_key.as_deref() != Some(preview_key.as_str())
        {
            let _ = self.worker_tx.send(BackgroundCommand::LoadDetail {
                repo_root: state.repo_root.clone(),
                rel_path: file.rel_path.clone(),
                state_code: file.state_code.clone(),
                version: file.last_modified_at_ms,
                mode: DetailMode::File,
            });
            self.pending_preview_key = Some(preview_key);
        }

        let diff_key = detail_cache_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
            DetailMode::Diff,
        );
        if !self.diff_cache.contains_key(&diff_key)
            && self.pending_diff_key.as_deref() != Some(diff_key.as_str())
        {
            let _ = self.worker_tx.send(BackgroundCommand::LoadDetail {
                repo_root: state.repo_root.clone(),
                rel_path: file.rel_path.clone(),
                state_code: file.state_code.clone(),
                version: file.last_modified_at_ms,
                mode: DetailMode::Diff,
            });
            self.pending_diff_key = Some(diff_key);
        }
    }

    fn diff_stat<'a>(&'a self, file: &crate::models::FileView) -> Option<&'a DiffStatSummary> {
        self.diff_stats.get(&diff_stat_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
        ))
    }

    fn detail_text(&self, file: &crate::models::FileView, mode: DetailMode) -> Option<&str> {
        let key = detail_cache_key(
            &file.rel_path,
            &file.state_code,
            file.last_modified_at_ms,
            mode,
        );
        match mode {
            DetailMode::File => self.preview_cache.get(&key).map(|entry| entry.text.as_str()),
            DetailMode::Summary | DetailMode::Diff => {
                self.diff_cache.get(&key).map(|entry| entry.text.as_str())
            }
        }
    }
}

pub fn run(ctx: RepoContext, poll_interval_ms: u64) -> Result<()> {
    enable_raw_mode().context("enable raw mode")?;
    execute!(stdout(), EnterAlternateScreen).context("enter alternate screen")?;
    let mut terminal = ratatui::init();
    let result = run_loop(&mut terminal, ctx, poll_interval_ms.max(200));
    ratatui::restore();
    let _ = execute!(stdout(), LeaveAlternateScreen);
    let _ = disable_raw_mode();
    result
}

fn run_loop(terminal: &mut DefaultTerminal, ctx: RepoContext, poll_interval_ms: u64) -> Result<()> {
    let mut feed = RuntimeFeed::open(&ctx.runtime_event_path)?;
    ensure_runtime_service(&ctx)?;
    let repo_root = ctx.repo_root.to_string_lossy().to_string();
    let repo_name = ctx
        .repo_root
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| repo_root.clone());
    let branch = current_branch(&ctx).unwrap_or_else(|_| "-".to_string());
    let mut state = RuntimeState::new(repo_root, repo_name, branch);
    state.set_runtime_transport(read_runtime_transport(&ctx));
    let mut cache = AppCache::new();
    let bootstrap_cutoff = chrono::Utc::now().timestamp_millis() - DEFAULT_INFERENCE_WINDOW_MS;
    for message in feed.read_recent_since(bootstrap_cutoff)? {
        state.apply_message(message);
    }
    let mut last_poll = Instant::now() - Duration::from_millis(poll_interval_ms);

    loop {
        let mut force_scan = false;
        if last_poll.elapsed() >= Duration::from_millis(poll_interval_ms) {
            let dirty = observe::scan_repo(&ctx)?;
            state.sync_dirty_files(dirty);
            last_poll = Instant::now();
        }

        for message in feed.read_new()? {
            if matches!(message, crate::models::RuntimeMessage::Git(_)) {
                force_scan = true;
            }
            state.apply_message(message);
        }
        if force_scan {
            let dirty = observe::scan_repo(&ctx)?;
            state.sync_dirty_files(dirty);
            last_poll = Instant::now();
        }

        state.set_runtime_transport(read_runtime_transport(&ctx));
        cache.sync_results();
        cache.warm_visible_files(&state);
        cache.warm_selected_detail(&state);

        terminal.draw(|frame| render(frame, &state, &feed, &cache))?;

        if event::poll(Duration::from_millis(100)).context("poll terminal events")?
            && handle_event(&mut state, &ctx)?
        {
            break;
        }
    }
    Ok(())
}

fn handle_event(state: &mut RuntimeState, ctx: &RepoContext) -> Result<bool> {
    match event::read().context("read terminal event")? {
        Event::Key(key) => {
            if state.search_active {
                match key.code {
                    KeyCode::Esc => state.cancel_search(),
                    KeyCode::Enter => state.cancel_search(),
                    KeyCode::Backspace => state.pop_search_char(),
                    KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        state.clear_search()
                    }
                    KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                        state.push_search_char(ch)
                    }
                    _ => {}
                }
                return Ok(false);
            }
            match key.code {
                KeyCode::Char('q') => return Ok(true),
                KeyCode::Tab => state.cycle_focus(),
                KeyCode::Char('j') | KeyCode::Down => state.move_selection_down(),
                KeyCode::Char('k') | KeyCode::Up => state.move_selection_up(),
                KeyCode::Char('h') | KeyCode::Left => state.select_prev_file(),
                KeyCode::Char('l') | KeyCode::Right => state.select_next_file(),
                KeyCode::Enter => state.toggle_file_view(),
                KeyCode::Char('/') => state.begin_search(),
                KeyCode::Esc => state.clear_search(),
                KeyCode::Char('r') => state.toggle_follow_mode(),
                KeyCode::Char('s') => state.cycle_file_list_mode(),
                KeyCode::Char('d') | KeyCode::Char('D') => state.toggle_detail_mode(),
                KeyCode::Char('t') | KeyCode::Char('T') => state.toggle_theme_mode(),
                KeyCode::Char('1') => state.set_event_log_filter(EventLogFilter::All),
                KeyCode::Char('2') => state.set_event_log_filter(EventLogFilter::Hook),
                KeyCode::Char('3') => state.set_event_log_filter(EventLogFilter::Git),
                KeyCode::Char('4') => state.set_event_log_filter(EventLogFilter::Watch),
                KeyCode::Char('[') => jump_diff_hunk(state, ctx, false)?,
                KeyCode::Char(']') => jump_diff_hunk(state, ctx, true)?,
                KeyCode::PageDown => {
                    for _ in 0..10 {
                        state.move_selection_down();
                    }
                }
                KeyCode::PageUp => {
                    for _ in 0..10 {
                        state.move_selection_up();
                    }
                }
                KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    return Ok(true);
                }
                _ => {}
            }
        }
        Event::Resize(_, _) => {}
        _ => {}
    }
    Ok(false)
}

fn diff_stat_key(rel_path: &str, state_code: &str, version: i64) -> String {
    format!("{rel_path}:{state_code}:{version}")
}

fn detail_cache_key(rel_path: &str, state_code: &str, version: i64, mode: DetailMode) -> String {
    format!("{rel_path}:{state_code}:{version}:{mode:?}")
}

fn short_state_code(state_code: &str) -> &'static str {
    match state_code {
        "delete" => "D",
        "add" | "untracked" => "A",
        "rename" => "R",
        _ => "M",
    }
}

fn compute_diff_stat(repo_root: &str, rel_path: &str, state_code: &str) -> DiffStatSummary {
    let status = short_state_code(state_code).to_string();

    if state_code == "untracked" || state_code == "add" {
        let path = Path::new(repo_root).join(rel_path);
        let added = std::fs::read_to_string(path)
            .ok()
            .map(|text| text.lines().count())
            .unwrap_or(0);
        return DiffStatSummary {
            status,
            additions: Some(added),
            deletions: None,
        };
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("diff")
        .arg("--numstat")
        .arg("--")
        .arg(rel_path)
        .output();
    if let Ok(output) = output {
        if output.status.success() {
            if let Ok(stdout) = String::from_utf8(output.stdout) {
                if let Some(line) = stdout.lines().find(|line| !line.trim().is_empty()) {
                    let cols: Vec<&str> = line.split_whitespace().collect();
                    if cols.len() >= 2 {
                        let add = cols[0];
                        let del = cols[1];
                        if add == "-" || del == "-" {
                            return DiffStatSummary {
                                status,
                                additions: None,
                                deletions: None,
                            };
                        }
                        let add_num = add.parse::<usize>().unwrap_or(0);
                        let del_num = del.parse::<usize>().unwrap_or(0);
                        return match (add_num, del_num) {
                            (0, 0) => DiffStatSummary {
                                status,
                                additions: None,
                                deletions: None,
                            },
                            (0, d) => DiffStatSummary {
                                status,
                                additions: None,
                                deletions: Some(d),
                            },
                            (a, 0) => DiffStatSummary {
                                status,
                                additions: Some(a),
                                deletions: None,
                            },
                            (a, d) => DiffStatSummary {
                                status,
                                additions: Some(a),
                                deletions: Some(d),
                            },
                        };
                    }
                }
            }
        }
    }

    DiffStatSummary {
        status,
        additions: None,
        deletions: None,
    }
}

fn background_worker(rx: Receiver<BackgroundCommand>, tx: Sender<BackgroundResult>) {
    while let Ok(command) = rx.recv() {
        match command {
            BackgroundCommand::RefreshStats { repo_root, files } => {
                let mut seen = BTreeSet::new();
                let entries = files
                    .into_iter()
                    .filter_map(|(rel_path, state_code, version)| {
                        let key = diff_stat_key(&rel_path, &state_code, version);
                        if !seen.insert(key.clone()) {
                            return None;
                        }
                        Some((key, compute_diff_stat(&repo_root, &rel_path, &state_code)))
                    })
                    .collect::<Vec<_>>();
                let _ = tx.send(BackgroundResult::Stats { entries });
            }
            BackgroundCommand::LoadDetail {
                repo_root,
                rel_path,
                state_code,
                version,
                mode,
            } => {
                let text = match mode {
                    DetailMode::File => load_file_preview(&repo_root, rel_path.as_str())
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| "<no file content available>".to_string()),
                    DetailMode::Summary | DetailMode::Diff => {
                        load_diff_text(&repo_root, rel_path.as_str(), state_code.as_str())
                            .ok()
                            .flatten()
                            .unwrap_or_else(|| "<no diff available>".to_string())
                    }
                };
                let _ = tx.send(BackgroundResult::Detail {
                    entry: DetailCacheEntry {
                        key: detail_cache_key(&rel_path, &state_code, version, mode),
                        text,
                    },
                    mode,
                });
            }
        }
    }
}

fn current_branch(ctx: &RepoContext) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&ctx.repo_root)
        .arg("branch")
        .arg("--show-current")
        .output()
        .context("run git branch --show-current")?;
    if !output.status.success() {
        anyhow::bail!("git branch --show-current failed");
    }
    Ok(String::from_utf8(output.stdout)
        .context("decode branch output")?
        .trim()
        .to_string())
}

fn load_diff_text(repo_root: &str, rel_path: &str, state_code: &str) -> Result<Option<String>> {
    let path = Path::new(repo_root).join(rel_path);
    if state_code == "untracked" {
        if !path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(&path).context("read untracked file")?;
        let mut out = Vec::new();
        out.push(format!("+++ {}", rel_path));
        for line in content.lines().take(200) {
            out.push(format!("+{line}"));
        }
        return Ok(Some(out.join("\n")));
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("diff")
        .arg("--no-ext-diff")
        .arg("--no-color")
        .arg("--")
        .arg(rel_path)
        .output()
        .context("run git diff")?;

    if !output.status.success() {
        return Ok(None);
    }

    let text = String::from_utf8(output.stdout).context("decode git diff output")?;
    if text.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(text))
    }
}

fn load_file_preview(repo_root: &str, rel_path: &str) -> Result<Option<String>> {
    let path = Path::new(repo_root).join(rel_path);
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(path).context("read file preview")?;
    let truncated = content.lines().take(400).collect::<Vec<_>>().join("\n");
    Ok(Some(truncated))
}

fn jump_diff_hunk(state: &mut RuntimeState, ctx: &RepoContext, forward: bool) -> Result<()> {
    let Some((rel_path, state_code)) = state
        .selected_file()
        .map(|file| (file.rel_path.clone(), file.state_code.clone()))
    else {
        return Ok(());
    };
    let diff_text = load_diff_text(&ctx.repo_root.to_string_lossy(), &rel_path, &state_code)?
        .unwrap_or_default();
    let hunks = diff_hunk_offsets(&diff_text);
    if hunks.is_empty() {
        return Ok(());
    }
    let current = state.detail_scroll as usize;
    let target = if forward {
        hunks
            .iter()
            .copied()
            .find(|offset| *offset > current)
            .unwrap_or(hunks[0])
    } else {
        hunks
            .iter()
            .copied()
            .rev()
            .find(|offset| *offset < current)
            .unwrap_or(*hunks.last().unwrap_or(&0))
    };
    state.detail_scroll = target.min(u16::MAX as usize) as u16;
    state
        .detail_scroll_cache
        .insert(rel_path, state.detail_scroll);
    Ok(())
}

fn diff_hunk_offsets(diff_text: &str) -> Vec<usize> {
    diff_text
        .lines()
        .enumerate()
        .filter_map(|(idx, line)| line.starts_with("@@").then_some(idx))
        .collect()
}

fn ensure_runtime_service(ctx: &RepoContext) -> Result<()> {
    if runtime_service_is_fresh(ctx) {
        return Ok(());
    }

    let current_exe = env::current_exe().context("resolve current agentwatch executable")?;
    let mut command = Command::new(current_exe);
    command
        .arg("--repo")
        .arg(&ctx.repo_root)
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let _child = command.spawn().context("spawn agentwatch runtime service")?;

    let deadline = Instant::now() + Duration::from_millis(1200);
    while Instant::now() < deadline {
        if runtime_service_is_fresh(ctx) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(60));
    }

    Ok(())
}

fn runtime_service_is_fresh(ctx: &RepoContext) -> bool {
    crate::ipc::read_service_info(&ctx.runtime_info_path)
        .ok()
        .flatten()
        .is_some_and(|info| chrono::Utc::now().timestamp_millis() - info.last_seen_at_ms < 2500)
}

fn read_runtime_transport(ctx: &RepoContext) -> String {
    crate::ipc::read_service_info(&ctx.runtime_info_path)
        .ok()
        .flatten()
        .and_then(|info| {
            let age = chrono::Utc::now().timestamp_millis() - info.last_seen_at_ms;
            (age < 2500).then_some(info.transport)
        })
        .unwrap_or_else(|| "feed".to_string())
}

#[allow(dead_code)]
pub fn default_poll_ms() -> u64 {
    DEFAULT_TUI_POLL_MS
}

#[path = "tui_render.rs"]
mod render;
use render::*;

#[cfg(test)]
#[path = "tui_tests.rs"]
mod tests;
