---
slug: /
title: Routa Docs
---

## Routa Overview

Routa is a workspace-first multi-agent coordination platform for software delivery. It keeps
work attached to explicit product objects such as workspaces, sessions, boards, specialists, and
codebases instead of hiding everything inside one long-running chat.

Routa combines a workspace-first UI, Kanban automation, and protocol bridges across ACP, MCP,
A2A, and AG-UI so teams can route real implementation work through visible execution surfaces.

## Get Started

Choose the path that matches how you want to start using Routa:

<div className="routa-doc-map">
  <a href="./platforms/desktop">
    <strong>Desktop</strong>
    Recommended for most users. Download the app from GitHub Releases and use the full product
    surface.
  </a>
  <a href="./platforms/cli">
    <strong>CLI</strong>
    Best for terminal-first workflows. Install <code>routa-cli</code> and start directly inside a repository.
  </a>
  <a href="./platforms/web">
    <strong>Web</strong>
    Best for contributors and self-hosters. Run the web/runtime surface from source.
  </a>
</div>

If you want the shortest installation path, read [Quick Start](./quick-start).

## What You Can Do

<div className="routa-grid">
  <div className="routa-card routa-card--blue">
    <h3>Understand Codebases</h3>
    <p>
      Use Sessions to understand a new repository, inspect architecture, and recover work later
      from one main thread.
    </p>
  </div>
  <div className="routa-card routa-card--orange">
    <h3>Run Delivery Flow</h3>
    <p>
      Use Kanban when work needs explicit stages, specialist-by-lane automation, and review or
      done gates that actually enforce quality.
    </p>
  </div>
  <div className="routa-card routa-card--green">
    <h3>Coordinate Specialists</h3>
    <p>
      Use Team when the coordination problem is itself first-class and the work benefits from a
      lead dispatching child sessions across specialties.
    </p>
  </div>
</div>

## Use Routa Everywhere

Routa preserves the same core product model across multiple runtime surfaces:

- `Desktop` for the packaged local-first product
- `CLI` for prompts, scripting, and runtime inspection
- `Web` for local contribution and self-hosting

The important concepts stay the same across these surfaces: workspace scope, provider-backed
execution, and the three main working modes `Session`, `Kanban`, and `Team`.

## Documentation Map

<div className="routa-doc-map">
  <a href="./getting-started">
    <strong>Getting Started</strong>
    The start path: overview, quick start, and changelog entry points.
  </a>
  <a href="./core-concepts">
    <strong>Core Concepts</strong>
    Workspace, sessions, Kanban, Team, providers, and the product model.
  </a>
  <a href="./use-routa">
    <strong>Use Routa</strong>
    Sessions, Kanban, Team, and the practical mode choices after setup.
  </a>
  <a href="./platforms">
    <strong>Platforms</strong>
    Desktop, CLI, and Web as separate runtime surfaces and onboarding paths.
  </a>
  <a href="./administration">
    <strong>Administration</strong>
    Self-hosting, deployment, operational setup, and release-oriented guidance.
  </a>
  <a href="./configuration">
    <strong>Configuration</strong>
    Providers, models, role defaults, and environment variables.
  </a>
  <a href="./deployment">
    <strong>Deployment</strong>
    Release artifacts, downloadable builds, and maintainer publishing guidance.
  </a>
  <a href="./reference">
    <strong>Reference</strong>
    Product specs, specialists, release process, and coding conventions.
  </a>
  <a href="./whats-new">
    <strong>What's New</strong>
    Recent release notes, changelog entry points, and current product updates.
  </a>
</div>

## Next Steps

- Read [Getting Started](./getting-started) for the first 10 minutes path
- Read [Use Routa](./use-routa) for Sessions, Kanban, Team, and common workflows
- Read [Administration](./administration) if you are running or publishing Routa
- Read [What's New](./whats-new) for recent release notes and updates
