//! Terminal output formatting helpers for `routa review`.

use serde::Serialize;

pub(crate) fn print_pretty_json<T: Serialize>(
    value: &T,
    error_context: &str,
) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string_pretty(value)
            .map_err(|err| format!("Failed to format {}: {}", error_context, err))?
    );
    Ok(())
}

pub(crate) fn print_review_result(
    title: &str,
    output: &str,
    as_json: bool,
    error_context: &str,
) -> Result<(), String> {
    println!();
    println!("═══ {} ═══", title);
    if as_json {
        match serde_json::from_str::<serde_json::Value>(output) {
            Ok(value) => print_pretty_json(&value, error_context)?,
            Err(_) => println!("{}", output),
        }
    } else {
        println!("{}", output);
    }
    Ok(())
}
