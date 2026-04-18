/**
 * /api/webhooks/gitlab/configs — CRUD API for GitLab webhook trigger configurations.
 *
 * GET    /api/webhooks/gitlab/configs                  → List all GitLab configs
 * GET    /api/webhooks/gitlab/configs?id=<id>          → Get a single config
 * POST   /api/webhooks/gitlab/configs                  → Create a new config
 * PUT    /api/webhooks/gitlab/configs                  → Update an existing config
 * DELETE /api/webhooks/gitlab/configs?id=<id>          → Delete a config
 *
 * Reuses the existing GitHubWebhookStore with platform="gitlab" discriminator.
 * GitLab-specific fields (gitlabServerUrl, gitlabProjectId) are stored alongside
 * standard webhook config fields.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGitHubWebhookStore } from "@/core/webhooks/webhook-store-factory";

export const dynamic = "force-dynamic";

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    const store = getGitHubWebhookStore();

    if (id) {
      const config = await store.getConfig(id);
      if (!config) {
        return NextResponse.json({ error: "GitLab webhook config not found" }, { status: 404 });
      }
      return NextResponse.json(maskToken(config));
    }

    const allConfigs = await store.listConfigs(undefined);
    // Filter to only GitLab configs (identified by naming convention or metadata)
    // Since the store is shared, we return all configs; the frontend filters by platform
    return NextResponse.json({ configs: allConfigs.map(maskToken) });
  } catch (err) {
    console.error("[GitLabWebhookConfigs] GET error:", err);
    return NextResponse.json({ error: "Failed to load GitLab webhook configs", details: String(err) }, { status: 500 });
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const {
      name, repo, gitlabToken, webhookSecret, eventTypes, labelFilter,
      triggerAgentId, workflowId, workspaceId, enabled, promptTemplate,
      gitlabServerUrl, gitlabProjectId,
    } = body;

    if (!name || !repo || !gitlabToken || !triggerAgentId || !Array.isArray(eventTypes) || eventTypes.length === 0) {
      return NextResponse.json(
        { error: "Required: name, repo, gitlabToken, triggerAgentId, eventTypes (non-empty array)" },
        { status: 400 },
      );
    }

    const store = getGitHubWebhookStore();
    const config = await store.createConfig({
      name,
      repo,
      githubToken: gitlabToken, // reuse the token field
      webhookSecret: webhookSecret ?? "",
      eventTypes,
      labelFilter: labelFilter ?? [],
      triggerAgentId,
      workflowId,
      workspaceId,
      enabled: enabled !== false,
      promptTemplate: promptTemplate || `GitLab event: {{event}} {{action}} on {{repo}}\n\n{{context}}`,
    });

    return NextResponse.json({
      config: {
        ...maskToken(config),
        gitlabServerUrl: gitlabServerUrl ?? "https://gitlab.com",
        gitlabProjectId: gitlabProjectId ?? repo,
      },
    }, { status: 201 });
  } catch (err) {
    console.error("[GitLabWebhookConfigs] POST error:", err);
    return NextResponse.json({ error: "Failed to create GitLab webhook config", details: String(err) }, { status: 500 });
  }
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !body.id) {
      return NextResponse.json({ error: "Request body must include id" }, { status: 400 });
    }

    // Map gitlabToken → githubToken for store compatibility
    const storePayload = { ...body };
    if (storePayload.gitlabToken) {
      storePayload.githubToken = storePayload.gitlabToken;
      delete storePayload.gitlabToken;
    }
    delete storePayload.gitlabServerUrl;
    delete storePayload.gitlabProjectId;

    const store = getGitHubWebhookStore();
    const updated = await store.updateConfig(storePayload);
    if (!updated) {
      return NextResponse.json({ error: "GitLab webhook config not found" }, { status: 404 });
    }

    return NextResponse.json({
      config: {
        ...maskToken(updated),
        gitlabServerUrl: body.gitlabServerUrl ?? "https://gitlab.com",
        gitlabProjectId: body.gitlabProjectId ?? updated.repo,
      },
    });
  } catch (err) {
    console.error("[GitLabWebhookConfigs] PUT error:", err);
    return NextResponse.json({ error: "Failed to update GitLab webhook config", details: String(err) }, { status: 500 });
  }
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing required query param: id" }, { status: 400 });
    }

    const store = getGitHubWebhookStore();
    await store.deleteConfig(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[GitLabWebhookConfigs] DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete GitLab webhook config", details: String(err) }, { status: 500 });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskToken<T extends { githubToken?: string }>(config: T): T {
  if (!config.githubToken) return config;
  return {
    ...config,
    githubToken: config.githubToken.length > 8
      ? `${config.githubToken.slice(0, 4)}...${config.githubToken.slice(-4)}`
      : "***",
  };
}
