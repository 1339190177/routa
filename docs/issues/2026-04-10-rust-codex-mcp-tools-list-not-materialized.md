---
title: "Rust desktop Codex MCP session connects but still exposes no usable Routa tools"
date: "2026-04-10"
status: investigating
severity: high
area: "desktop"
tags: [rust, desktop, codex, mcp, kanban, protocol, tauri]
reported_by: "Codex"
related_issues:
  - "2026-04-10-rust-codex-mcp-config-not-injected-on-launch.md"
---

# Rust desktop Codex MCP session connects but still exposes no usable Routa tools

## What Happened

In the Rust desktop Kanban flow, Codex sessions can now start with the Routa MCP server configured, but the agent still behaves as if no Kanban planning tools are available.

Observed behavior:

- Codex conversation attempts generic MCP discovery calls such as `list_mcp_resources` and `list_mcp_resource_templates`.
- Codex then reports that tools like `create_card`, `decompose_tasks`, and `search_cards` are not exposed in the session.
- The Rust backend logs show that Codex did send MCP requests to Routa, including:
  - `initialize`
  - `notifications/initialized`
  - `tools/list`
  - `resources/list`
  - `resources/templates/list`
- `codex app-server` runtime inspection shows the MCP server entry is present as `routa-coordination`, but its tool inventory is still empty from Codex's point of view.

This means the failure has moved past configuration injection. Codex can see the MCP server, but it is not materializing the Routa tool list into the active session.

## Expected Behavior

- Rust desktop Codex sessions should expose the same Routa MCP tools that work in the Next.js flow.
- A Kanban planning session with `mcpProfile=kanban-planning` should surface `create_card`, `decompose_tasks`, `search_cards`, `list_cards_by_column`, `update_task`, `update_card`, `move_card`, `request_previous_lane_handoff`, and `submit_lane_handoff`.
- Codex should not fall back to "tooling gap" reasoning when the server has already received `tools/list`.

## Reproduction Context

- Environment: desktop
- Trigger: open a Rust/Tauri Kanban board, choose Codex, submit a planning request such as `create a js hello world`, then inspect the Codex session transcript and MCP server status.

## Why This Might Happen

- The original working theory was that the Rust `/api/mcp` endpoint diverged from SDK streamable-HTTP semantics.
- That theory is now weakened: Rust has been switched to the official `rmcp::transport::StreamableHttpService`, and the same empty-tool result can also be reproduced against the Next.js MCP route with a direct `codex app-server` probe.
- The remaining gap is now more likely in Codex startup inventory hydration or in a compatibility edge between Codex's streamable-HTTP client and the way Routa's MCP routes answer `initialize` / `notifications/initialized` / `tools/list`.
- `mcpServerStatus/list` only shows tools after Codex's MCP startup path has successfully initialized and loaded tool inventory; if startup partially succeeds but inventory loading fails or yields zero tools, the UI ends up with an empty server entry and no explicit error in the status response.

## Relevant Files

- `crates/routa-server/src/api/mcp_routes.rs`
- `crates/routa-server/src/api/mcp_routes/tool_catalog.rs`
- `crates/routa-server/tests/rust_api_mcp_routes.rs`
- `src/app/api/mcp/route.ts`
- `crates/routa-core/src/acp/process.rs`
- `/Users/phodal/ai/codex/codex-rs/codex-mcp/src/mcp_connection_manager.rs`
- `/Users/phodal/ai/codex/codex-rs/rmcp-client/src/rmcp_client.rs`

## Observations

- `config/read` from `codex app-server` confirms that `mcp_servers.routa-coordination` is active, with origin `sessionFlags`.
- `mcpServerStatus/list` from `codex app-server` reports `routa-coordination`, but `tools` remains empty.
- A concrete protocol bug was already identified in the Rust route: `notifications/initialized` incorrectly returned a JSON-RPC body. That has been fixed locally in the working tree and covered by a Rust test, but the overall tool hydration issue remains unresolved.
- Rust `/api/mcp` has now been migrated to the official `rmcp` `StreamableHttpService`, and the Rust MCP contract tests pass with SSE initialize + initialized-notification flow.
- A direct `codex app-server` probe against the Rust route still returns:
  - `name: "routa-coordination"`
  - `tools: {}`
  - `resources: []`
  - `resourceTemplates: []`
- Running the same probe against the Next.js `/api/mcp` route also leaves `routa-coordination.tools` empty, which means the empty-tool symptom is no longer isolated to Rust transport implementation.
- The current evidence suggests the remaining issue is in Codex's MCP startup/inventory path rather than in the Rust route's hand-written transport layer.

## References

- `docs/issues/2026-04-10-rust-codex-mcp-config-not-injected-on-launch.md`
