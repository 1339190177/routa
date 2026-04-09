"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";
import type { SessionInfo } from "../../types";

interface TeamRunPageHeaderProps {
  workspaceId: string;
  selectedSessionId: string;
  selectedSessionName: string;
  teamRuns: SessionInfo[];
  isSwitchingTeamRun: boolean;
  backLabel: string;
  refreshLabel: string;
  openLabel: string;
  activeLabel: string;
  waitingLabel: string;
  onRefresh: () => void;
  onSwitchTeamRun: (sessionId: string) => void;
}

export function TeamRunPageHeader({
  workspaceId,
  selectedSessionId,
  selectedSessionName,
  teamRuns,
  isSwitchingTeamRun,
  backLabel,
  refreshLabel,
  openLabel,
  activeLabel,
  waitingLabel,
  onRefresh,
  onSwitchTeamRun,
}: TeamRunPageHeaderProps) {
  const [showTeamRunMenu, setShowTeamRunMenu] = useState(false);
  const teamRunSwitcherRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!teamRunSwitcherRef.current) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!teamRunSwitcherRef.current?.contains(event.target as Node)) {
        setShowTeamRunMenu(false);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedTeamRun = teamRuns.find((run) => run.sessionId === selectedSessionId) ?? teamRuns[0];
  const canSwitchTeamRun = teamRuns.length > 1;

  return (
    <header className="shrink-0 border-b border-desktop-border px-4 py-2.5" data-testid="team-run-page-header">
      <div className="mx-auto flex w-full max-w-440 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/workspace/${workspaceId}/team`}
            className="inline-flex shrink-0 items-center rounded-md bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
            title={backLabel}
            aria-label={backLabel}
          >
            <ChevronLeft
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            />
            <span className="sr-only">{backLabel}</span>
          </Link>
          <div ref={teamRunSwitcherRef} className="relative min-w-0">
            <button
              type="button"
              onClick={() => setShowTeamRunMenu((current) => canSwitchTeamRun ? !current : false)}
              className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-desktop-bg-secondary px-2.5 py-1.5 text-left text-[13px] font-semibold text-desktop-text-primary transition-colors hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
            >
              <h1 className="max-w-72 truncate">{selectedTeamRun?.name ?? selectedSessionName}</h1>
              {canSwitchTeamRun ? (
                <ChevronDown
                  className={`h-3.5 w-3.5 text-desktop-text-secondary transition-transform ${showTeamRunMenu ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                />
              ) : null}
              {isSwitchingTeamRun ? (
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
              ) : null}
            </button>
            {showTeamRunMenu && (
              <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-80 overflow-y-auto rounded-md border border-desktop-border bg-desktop-bg-primary p-1.5 shadow-xl">
                {teamRuns.map((run) => {
                  const isActive = run.sessionId === selectedSessionId;
                  return (
                    <button
                      key={run.sessionId}
                      type="button"
                      onClick={() => {
                        if (run.sessionId !== selectedSessionId) {
                          onSwitchTeamRun(run.sessionId);
                        }
                        setShowTeamRunMenu(false);
                      }}
                      className={`mb-0.5 flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-left text-[12px] ${
                        isActive
                          ? "bg-desktop-bg-active text-desktop-text-primary"
                          : "text-desktop-text-secondary hover:bg-desktop-bg-secondary"
                      }`}
                    >
                      <span className="truncate">{run.name ?? `Team run ${run.sessionId.slice(0, 8)}`}</span>
                      <span className="ml-2 shrink-0 text-[10px] uppercase tracking-[0.14em] text-desktop-text-muted">
                        {isActive ? activeLabel : waitingLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-md bg-desktop-bg-secondary px-2.5 py-1.5 text-[11px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active/70 hover:text-desktop-text-primary"
          >
            {refreshLabel}
          </button>
          <Link
            href={`/workspace/${workspaceId}/sessions/${selectedSessionId}`}
            className="rounded-md bg-desktop-accent px-2.5 py-1.5 text-[11px] font-medium text-desktop-accent-text transition-colors hover:opacity-90"
          >
            {openLabel}
          </Link>
        </div>
      </div>
    </header>
  );
}
