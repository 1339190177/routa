---
title: Platforms Overview
---

# Platforms

Routa exposes the same domain model across multiple runtime surfaces.

## Surface Comparison

| Surface | Best for | First action | Recommendation |
| --- | --- | --- | --- |
| [Desktop](/platforms/desktop) | most users, visual workflows, complete product surface | download from GitHub Releases | Recommended |
| [CLI](/platforms/cli) | terminal-first use, one-shot prompts, automation | install `routa-cli` from npm or Cargo | Recommended |
| [Web](/platforms/web) | contributors, local development, self-hosting | run the app from source | Optional |

## How To Choose

- Choose `Desktop` if you want the most complete Routa experience with the least setup friction.
- Choose `CLI` if you already work from the terminal and want prompt or runtime control directly in a repository.
- Choose `Web` if you are developing Routa itself or hosting the browser surface in your own environment.

## Shared Product Semantics

Across all three surfaces, the important product ideas stay the same:

- work is scoped to a workspace
- providers execute sessions
- repositories are attached to workspaces
- Session, Kanban, and Team remain the core working modes

## Read Next

- [Desktop](/platforms/desktop)
- [CLI](/platforms/cli)
- [Web](/platforms/web)
- [Architecture](/ARCHITECTURE) for the backend/runtime relationship
