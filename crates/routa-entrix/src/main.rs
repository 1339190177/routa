use clap::{Args, Parser, Subcommand};
use routa_entrix::file_budgets::{
    checked_count, evaluate_paths, load_config, resolve_paths,
};
use routa_entrix::review_trigger::{
    collect_changed_files, collect_diff_stats, evaluate_review_triggers, load_review_triggers,
};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "entrix")]
#[command(about = "Rust Entrix CLI")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    Hook(HookArgs),
    #[command(name = "review-trigger")]
    ReviewTrigger(ReviewTriggerArgs),
}

#[derive(Args, Debug)]
struct HookArgs {
    #[command(subcommand)]
    command: HookCommand,
}

#[derive(Subcommand, Debug)]
enum HookCommand {
    #[command(name = "file-length")]
    FileLength(FileLengthArgs),
}

#[derive(Args, Debug)]
struct FileLengthArgs {
    #[arg(long)]
    config: String,
    #[arg(long)]
    staged_only: bool,
    #[arg(long, default_value = "HEAD")]
    base: String,
    #[arg(long)]
    strict_limit: bool,
    #[arg(value_name = "files")]
    files: Vec<String>,
}

#[derive(Args, Debug)]
struct ReviewTriggerArgs {
    #[arg(long, default_value = "HEAD~1")]
    base: String,
    #[arg(long)]
    config: Option<String>,
    #[arg(long)]
    fail_on_trigger: bool,
    #[arg(long)]
    json: bool,
    #[arg(value_name = "files")]
    files: Vec<String>,
}

fn main() {
    std::process::exit(match Cli::parse().command {
        Command::Hook(hook) => match hook.command {
            HookCommand::FileLength(args) => cmd_hook_file_length(args),
        },
        Command::ReviewTrigger(args) => cmd_review_trigger(args),
    });
}

fn cmd_hook_file_length(args: FileLengthArgs) -> i32 {
    let project_root = find_project_root();
    let config_path = PathBuf::from(args.config);
    let config = load_config(&config_path);
    let relative_paths = match resolve_paths(
        &project_root,
        &config,
        &args.files,
        &args.base,
        args.staged_only,
    ) {
        Ok(paths) => paths,
        Err(error) => {
            eprintln!("failed to resolve file budget paths: {error}");
            return 1;
        }
    };

    let violations = evaluate_paths(
        &project_root,
        &relative_paths,
        &config,
        !args.strict_limit,
    );

    println!("file_budget_checked: {}", checked_count(&relative_paths, &config));
    println!("file_budget_violations: {}", violations.len());
    for violation in &violations {
        let reason = if violation.reason.is_empty() {
            String::new()
        } else {
            format!(" | {}", violation.reason)
        };
        println!(
            "current file length {} exceeds limit {}: {}{}",
            violation.line_count, violation.max_lines, violation.path, reason
        );
    }

    if !violations.is_empty() {
        println!("Refactor the oversized file before commit.");
        return 1;
    }

    0
}

fn find_project_root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for candidate in std::iter::once(cwd.as_path()).chain(cwd.ancestors().skip(1)) {
        if candidate.join("Cargo.toml").exists() || candidate.join("package.json").exists() {
            return candidate.to_path_buf();
        }
    }
    cwd
}

fn cmd_review_trigger(args: ReviewTriggerArgs) -> i32 {
    let project_root = find_project_root();
    let config_path = args
        .config
        .map(PathBuf::from)
        .unwrap_or_else(|| project_root.join("docs/fitness/review-triggers.yaml"));
    let rules = match load_review_triggers(&config_path) {
        Ok(rules) => rules,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let changed_files = if args.files.is_empty() {
        collect_changed_files(&project_root, &args.base)
    } else {
        args.files.clone()
    };
    let diff_stats = collect_diff_stats(&project_root, &args.base);
    let report = evaluate_review_triggers(
        &rules,
        &changed_files,
        &diff_stats,
        &args.base,
        Some(&project_root),
    );

    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&report).expect("serialize review trigger report")
        );
    } else {
        println!("REVIEW TRIGGER REPORT");
        println!("Base: {}", report.base);
        println!(
            "Diff stats: files={} added={} deleted={}",
            report.diff_stats.file_count,
            report.diff_stats.added_lines,
            report.diff_stats.deleted_lines
        );
        if report.human_review_required {
            println!("Human review required: yes");
            for trigger in &report.triggers {
                println!("- {} [{}]", trigger.name, trigger.severity);
                for reason in &trigger.reasons {
                    println!("  reason: {reason}");
                }
            }
        } else {
            println!("Human review required: no");
        }
    }

    if report.human_review_required && args.fail_on_trigger {
        3
    } else {
        0
    }
}
