import * as vscode from "vscode";

import { RoutaPanel, routaWorkspaceUrl } from "./routa-panel";
import { RoutaServerManager, type RoutaServerStatus } from "./server-manager";
import { ensureRoutaWorkspaceContext } from "./workspace-sync";

let serverManager: RoutaServerManager | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Routa");
  const manager = new RoutaServerManager(context, output);
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);

  serverManager = manager;
  outputChannel = output;
  statusBarItem = statusBar;

  statusBar.command = "routa.open";
  statusBar.show();
  updateStatusBar(manager.getStatus());

  context.subscriptions.push(
    output,
    manager,
    statusBar,
    manager.onDidChangeStatus(updateStatusBar),
    vscode.commands.registerCommand("routa.open", async () => {
      await openRouta(context, manager, output);
    }),
    vscode.commands.registerCommand("routa.startServer", async () => {
      const status = await manager.start();
      vscode.window.showInformationMessage(vscode.l10n.t("Routa server is running at {0}.", status.baseUrl ?? ""));
    }),
    vscode.commands.registerCommand("routa.stopServer", async () => {
      await manager.stop();
      vscode.window.showInformationMessage(vscode.l10n.t("Routa server stopped."));
    }),
    vscode.commands.registerCommand("routa.openInBrowser", async () => {
      const { status, workspaceId } = await ensureReady(context, manager, output);
      if (!status.baseUrl) {
        throw new Error(vscode.l10n.t("Routa server URL is unavailable."));
      }
      await vscode.env.openExternal(vscode.Uri.parse(routaWorkspaceUrl(status.baseUrl, workspaceId)));
    }),
    vscode.commands.registerCommand("routa.copyMcpEndpoint", async () => {
      const status = await manager.ensureStarted();
      if (!status.baseUrl) {
        throw new Error(vscode.l10n.t("Routa server URL is unavailable."));
      }
      await vscode.env.clipboard.writeText(`${status.baseUrl}/api/mcp`);
      vscode.window.showInformationMessage(vscode.l10n.t("Routa MCP endpoint copied."));
    }),
  );
}

export async function deactivate(): Promise<void> {
  await serverManager?.stop();
  serverManager?.dispose();
  outputChannel?.dispose();
  statusBarItem?.dispose();
}

async function openRouta(
  context: vscode.ExtensionContext,
  manager: RoutaServerManager,
  output: vscode.OutputChannel,
): Promise<void> {
  const { status, workspaceContext } = await ensureReady(context, manager, output);
  if (!status.baseUrl) {
    throw new Error(vscode.l10n.t("Routa server URL is unavailable."));
  }
  RoutaPanel.show(context, status.baseUrl, workspaceContext);
}

async function ensureReady(
  context: vscode.ExtensionContext,
  manager: RoutaServerManager,
  output: vscode.OutputChannel,
) {
  const status = await manager.ensureStarted();
  if (!status.baseUrl) {
    throw new Error(vscode.l10n.t("Routa server URL is unavailable."));
  }
  const workspaceContext = await ensureRoutaWorkspaceContext(context, status.baseUrl, output);
  return {
    status,
    workspaceContext,
    workspaceId: workspaceContext.workspaceId,
  };
}

function updateStatusBar(status: RoutaServerStatus): void {
  if (!statusBarItem) {
    return;
  }

  if (status.state === "running" || status.state === "external") {
    statusBarItem.text = "$(route) Routa";
    statusBarItem.tooltip = vscode.l10n.t("Routa server: {0}", status.baseUrl ?? "");
    return;
  }

  if (status.state === "starting") {
    statusBarItem.text = "$(sync~spin) Routa";
    statusBarItem.tooltip = vscode.l10n.t("Routa server is starting.");
    return;
  }

  if (status.state === "error") {
    statusBarItem.text = "$(warning) Routa";
    statusBarItem.tooltip = status.error ?? vscode.l10n.t("Routa server error.");
    return;
  }

  statusBarItem.text = "$(route) Routa";
  statusBarItem.tooltip = vscode.l10n.t("Open Routa.");
}
