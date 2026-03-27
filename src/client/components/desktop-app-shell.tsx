"use client";

/**
 * Desktop App Shell — Shared layout wrapper for all Tauri desktop pages.
 *
 * Provides consistent desktop app experience with:
 * - Compact title bar with window controls area
 * - Left sidebar navigation (VS Code style)
 * - Main content area
 *
 * This is a simpler version of DesktopLayout that doesn't require
 * workspace hooks - it accepts all data as props.
 */

import React from "react";
import { DesktopShellHeader } from "./desktop-shell-header";
import { DesktopSidebar } from "./desktop-sidebar";

interface DesktopAppShellProps {
  children: React.ReactNode;
  workspaceId?: string | null;
  /** Current workspace title for display */
  workspaceTitle?: string;
  /** Optional right side content for the title bar */
  titleBarRight?: React.ReactNode;
  /** Optional workspace switcher component */
  workspaceSwitcher?: React.ReactNode;
}

export function DesktopAppShell({
  children,
  workspaceId,
  workspaceTitle,
  titleBarRight,
  workspaceSwitcher,
}: DesktopAppShellProps) {
  return (
    <div
      className="desktop-theme h-screen flex flex-col overflow-hidden bg-desktop-bg-primary"
      data-testid="desktop-shell-root"
    >
      <DesktopShellHeader
        workspaceId={workspaceId}
        workspaceTitle={workspaceTitle}
        workspaceSwitcher={workspaceSwitcher}
        titleBarRight={titleBarRight}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0" data-testid="desktop-shell-body">
        <DesktopSidebar workspaceId={workspaceId} />

        {/* Content */}
        <main className="flex-1 min-w-0 overflow-hidden bg-desktop-bg-primary" data-testid="desktop-shell-main">
          {children}
        </main>
      </div>
    </div>
  );
}
