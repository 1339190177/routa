"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";

import type { RepoSelection } from "@/client/components/repo-picker";
import { ConnectionDot, OnboardingCard } from "@/client/components/home-page-sections";
import { NotificationBell, NotificationProvider } from "@/client/components/notification-center";
import {
  SettingsPanel,
  loadDefaultProviders,
  loadDockerOpencodeAuthJson,
  loadProviderConnections,
} from "@/client/components/settings-panel";
import { ThemeSwitcher } from "@/client/components/theme-switcher";
import { useAcp } from "@/client/hooks/use-acp";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { loadCustomAcpProviders } from "@/client/utils/custom-acp-providers";
import {
  clearOnboardingState,
  ONBOARDING_COMPLETED_KEY,
  ONBOARDING_MODE_KEY,
  hasSavedProviderConfiguration,
  parseOnboardingMode,
  type OnboardingMode,
} from "@/client/utils/onboarding";
import { useTranslation } from "@/i18n";
import type { KanbanBoardInfo, SessionInfo, TaskInfo } from "@/app/workspace/[workspaceId]/types";

interface WorkspaceHomeData {
  boards: KanbanBoardInfo[];
  sessions: SessionInfo[];
  tasks: TaskInfo[];
}

const EMPTY_HOME_DATA: WorkspaceHomeData = {
  boards: [],
  sessions: [],
  tasks: [],
};

function formatRelativeTime(value?: string) {
  if (!value) return "刚刚";
  const diffMs = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function getSessionLabel(session: SessionInfo) {
  if (session.name) return session.name;
  if (session.provider && session.role) return `${session.provider} · ${session.role.toLowerCase()}`;
  if (session.provider) return session.provider;
  return `会话 ${session.sessionId.slice(0, 8)}`;
}

function getTaskTone(task: TaskInfo) {
  const column = task.columnId?.toLowerCase() ?? "";
  if (column.includes("done") || task.status === "COMPLETED") {
    return "border-emerald-200 bg-emerald-50/85 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300";
  }
  if (column.includes("dev") || column.includes("doing") || task.status === "IN_PROGRESS") {
    return "border-sky-200 bg-sky-50/85 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-300";
  }
  return "border-amber-200 bg-amber-50/85 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300";
}

export default function HomePage() {
  const workspacesHook = useWorkspaces();
  const acp = useAcp();
  const { t } = useTranslation();

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"providers" | "roles" | "specialists" | undefined>(undefined);
  const [preferredMode, setPreferredMode] = useState<OnboardingMode | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [workspaceHomeData, setWorkspaceHomeData] = useState<Record<string, WorkspaceHomeData>>({});
  const [workspaceHomeLoading, setWorkspaceHomeLoading] = useState(false);

  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acp.connected, acp.loading]);

  useEffect(() => {
    if (!activeWorkspaceId && workspacesHook.workspaces.length > 0) {
      setActiveWorkspaceId(workspacesHook.workspaces[0].id);
    }
  }, [activeWorkspaceId, workspacesHook.workspaces]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setOnboardingCompleted(window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true");
    setPreferredMode(parseOnboardingMode(window.localStorage.getItem(ONBOARDING_MODE_KEY)));
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId || workspaceHomeData[activeWorkspaceId]) {
      return;
    }

    let cancelled = false;
    setWorkspaceHomeLoading(true);

    (async () => {
      try {
        const [boardsRes, tasksRes, sessionsRes] = await Promise.all([
          desktopAwareFetch(`/api/kanban/boards?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          desktopAwareFetch(`/api/tasks?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
          desktopAwareFetch(`/api/sessions?workspaceId=${encodeURIComponent(activeWorkspaceId)}&limit=8`, { cache: "no-store" }),
        ]);

        const [boardsData, tasksData, sessionsData] = await Promise.all([
          boardsRes.json().catch(() => ({})),
          tasksRes.json().catch(() => ({})),
          sessionsRes.json().catch(() => ({})),
        ]);

        if (cancelled) return;

        setWorkspaceHomeData((current) => ({
          ...current,
          [activeWorkspaceId]: {
            boards: Array.isArray(boardsData?.boards) ? boardsData.boards : [],
            tasks: Array.isArray(tasksData?.tasks) ? tasksData.tasks : [],
            sessions: Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : [],
          },
        }));
      } catch {
        if (cancelled) return;
        setWorkspaceHomeData((current) => ({
          ...current,
          [activeWorkspaceId]: EMPTY_HOME_DATA,
        }));
      } finally {
        if (!cancelled) {
          setWorkspaceHomeLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, workspaceHomeData]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const workspace = await workspacesHook.createWorkspace(title);
    if (workspace) {
      setActiveWorkspaceId(workspace.id);
      return true;
    }
    return false;
  }, [workspacesHook]);

  const handleOpenProviders = useCallback(() => {
    setSettingsInitialTab("providers");
    setShowSettingsPanel(true);
  }, []);

  const handleModeSelect = useCallback((mode: OnboardingMode) => {
    setPreferredMode(mode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_MODE_KEY, mode);
    }
  }, []);

  const handleDismissOnboarding = useCallback(() => {
    setOnboardingCompleted(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
    }
  }, []);

  const handleResetOnboarding = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    clearOnboardingState(window.localStorage);
    setOnboardingCompleted(false);
    setPreferredMode(null);
  }, []);

  const handleAddCodebase = useCallback(async (selection: RepoSelection) => {
    const targetWorkspaceId = activeWorkspaceId ?? workspacesHook.workspaces[0]?.id;
    if (!targetWorkspaceId) {
      return false;
    }

    const response = await desktopAwareFetch(`/api/workspaces/${encodeURIComponent(targetWorkspaceId)}/codebases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoPath: selection.path,
        branch: selection.branch || undefined,
        label: selection.name || undefined,
      }),
    });

    return response.ok;
  }, [activeWorkspaceId, workspacesHook.workspaces]);

  const activeWorkspace = workspacesHook.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const activeData = activeWorkspaceId ? (workspaceHomeData[activeWorkspaceId] ?? EMPTY_HOME_DATA) : EMPTY_HOME_DATA;
  const sortedBoards = useMemo(() => (
    [...activeData.boards].sort((left, right) => {
      const leftDate = left.updatedAt ?? left.createdAt;
      const rightDate = right.updatedAt ?? right.createdAt;
      return new Date(rightDate).getTime() - new Date(leftDate).getTime();
    })
  ), [activeData.boards]);
  const sortedTasks = useMemo(() => (
    [...activeData.tasks].sort((left, right) => {
      const leftDate = left.updatedAt ?? left.createdAt;
      const rightDate = right.updatedAt ?? right.createdAt;
      return new Date(rightDate).getTime() - new Date(leftDate).getTime();
    })
  ), [activeData.tasks]);
  const recentSessions = activeData.sessions.slice(0, 5);

  const hasWorkspace = workspacesHook.workspaces.length > 0;
  const hasProviderConfig =
    hasSavedProviderConfiguration(loadDefaultProviders(), loadProviderConnections(), {
      dockerOpencodeAuthJson: loadDockerOpencodeAuthJson(),
      customProviderCount: loadCustomAcpProviders().length,
    });
  const needsInlineOnboarding =
    hasWorkspace &&
    !onboardingCompleted &&
    (!hasProviderConfig || preferredMode === null);

  return (
    <NotificationProvider>
      <div className="relative flex h-screen min-h-screen flex-col overflow-hidden bg-[#f4f3ee] text-[#11151a] dark:bg-[#0d1117] dark:text-slate-100">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.86),transparent_40%),radial-gradient(circle_at_90%_10%,rgba(165,214,167,0.18),transparent_28%),linear-gradient(180deg,#f4f3ee_0%,#ece8de_100%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(31,41,55,0.35),transparent_30%),radial-gradient(circle_at_85%_15%,rgba(16,185,129,0.1),transparent_24%),linear-gradient(180deg,#0d1117_0%,#111827_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(17,21,26,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(17,21,26,0.03)_1px,transparent_1px)] bg-[size:120px_120px] opacity-50 dark:opacity-20" />
        </div>

        <header className="relative z-10 flex h-14 shrink-0 items-center border-b border-black/5 bg-white/70 px-4 backdrop-blur-xl dark:border-white/8 dark:bg-[#111827]/72">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-2xl border border-black/5 bg-white px-2 py-1.5 shadow-[0_14px_40px_-26px_rgba(15,23,42,0.35)] dark:border-white/10 dark:bg-white/5">
              <Image src="/logo.svg" alt="Routa" width={22} height={22} className="rounded-md" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold tracking-[0.01em] text-[#11151a] dark:text-slate-100">
                Routa
              </div>
              <div className="hidden text-[10px] uppercase tracking-[0.24em] text-[#607089] sm:block dark:text-slate-500">
                工作区首页
              </div>
            </div>
          </div>

          <div className="flex-1" />

          <nav className="flex items-center gap-2">
            <NotificationBell />
            <ThemeSwitcher compact className="border-black/8 bg-white/70 dark:border-white/10 dark:bg-white/[0.03]" />
            <button
              onClick={() => {
                setSettingsInitialTab(undefined);
                setShowSettingsPanel(true);
              }}
              className="rounded-full p-2 text-slate-500 transition-colors hover:bg-black/5 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-100"
              title={t.nav.settings}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <div className="ml-1 border-l border-black/8 pl-3 dark:border-white/8">
              <ConnectionDot connected={acp.connected} />
            </div>
          </nav>
        </header>

        <main className="relative z-10 min-h-0 flex-1 overflow-hidden">
          {workspacesHook.loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              {t.home.loadingWorkspaces}
            </div>
          ) : !hasWorkspace ? (
            <div className="flex h-full items-center justify-center px-4">
              <OnboardingCard
                hasWorkspace={false}
                workspaceTitle={null}
                hasProviderConfig={hasProviderConfig}
                hasCodebase={false}
                preferredMode={preferredMode}
                onCreateWorkspace={handleWorkspaceCreate}
                onOpenProviders={handleOpenProviders}
                onAddCodebase={handleAddCodebase}
                onSelectMode={handleModeSelect}
              />
            </div>
          ) : (
            <div className="grid h-full grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[260px_minmax(0,1fr)_320px]">
              <aside className="rounded-[28px] border border-black/5 bg-white/82 p-4 shadow-[0_24px_70px_-52px_rgba(15,23,42,0.45)] dark:border-white/8 dark:bg-[#111827]/84">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#728197] dark:text-slate-500">
                      工作区
                    </div>
                    <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      选择一个工作区
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void handleWorkspaceCreate("New Workspace");
                    }}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-black/5 bg-[#eef2ea] text-[#425746] transition-colors hover:bg-[#e4ebdf] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
                    title="新建工作区"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>

                <div className="mt-5 space-y-2">
                  {workspacesHook.workspaces.map((workspace) => {
                    const active = workspace.id === activeWorkspaceId;
                    return (
                      <button
                        key={workspace.id}
                        type="button"
                        onClick={() => setActiveWorkspaceId(workspace.id)}
                        className={`w-full rounded-[22px] border px-4 py-3 text-left transition-all ${
                          active
                            ? "border-[#99c18f] bg-[#edf5e8] text-[#1e3320] shadow-[0_18px_40px_-34px_rgba(34,84,61,0.45)] dark:border-emerald-800/50 dark:bg-emerald-950/20 dark:text-emerald-100"
                            : "border-black/5 bg-white/78 text-slate-700 hover:border-[#d4dccb] hover:bg-[#f7f7f2] dark:border-white/8 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:bg-white/[0.05]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">
                              {workspace.title}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                              更新于 {formatRelativeTime(workspace.updatedAt)}
                            </div>
                          </div>
                          {active && (
                            <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4a6a4d] dark:bg-emerald-900/50 dark:text-emerald-200">
                              当前
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-6 rounded-[24px] border border-dashed border-black/8 bg-[#f6f3ec] p-4 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#728197] dark:text-slate-500">
                    工作区状态
                  </div>
                  <div className="mt-3 space-y-2 text-[12px] text-slate-600 dark:text-slate-300">
                    <div className="flex items-center justify-between gap-3">
                      <span>运行时</span>
                      <span className={acp.connected ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}>
                        {acp.connected ? "在线" : "离线"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>模型配置</span>
                      <span className={hasProviderConfig ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}>
                        {hasProviderConfig ? "已就绪" : "待配置"}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenProviders}
                    className="mt-4 w-full rounded-full border border-black/8 bg-white/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700 transition-colors hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
                  >
                    打开模型设置
                  </button>
                </div>
              </aside>

              <section className="space-y-4">
                {needsInlineOnboarding && (
                  <OnboardingCard
                    hasWorkspace
                    workspaceTitle={activeWorkspace?.title ?? null}
                    hasProviderConfig={hasProviderConfig}
                    hasCodebase={sortedBoards.length > 0}
                    preferredMode={preferredMode}
                    onCreateWorkspace={handleWorkspaceCreate}
                    onOpenProviders={handleOpenProviders}
                    onAddCodebase={handleAddCodebase}
                    onSelectMode={handleModeSelect}
                    onDismiss={handleDismissOnboarding}
                  />
                )}

                <section className="overflow-hidden rounded-[32px] border border-black/5 bg-[linear-gradient(135deg,#f7f5ef_0%,#ebe6d8_100%)] p-5 shadow-[0_30px_80px_-56px_rgba(15,23,42,0.45)] dark:border-white/8 dark:bg-[linear-gradient(135deg,#111827_0%,#172033_100%)]">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div className="max-w-2xl">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#728197] dark:text-slate-500">
                        {activeWorkspace?.title ?? "工作区"} 首页
                      </div>
                      <h1 className="mt-3 font-['Avenir_Next_Condensed','Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] text-[2.4rem] font-semibold leading-[0.92] tracking-[-0.05em] text-[#11151a] dark:text-slate-100 sm:text-[3.15rem]">
                        先看板，再进入执行。
                      </h1>
                      <p className="mt-4 max-w-xl text-sm leading-7 text-slate-600 dark:text-slate-300">
                        把看板、卡片和最近执行放在同一个入口里。先判断现在要推进什么，再进入具体会话，不用在首页和详情页之间来回切换。
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <Link
                        href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}/kanban` : "/"}
                        className="rounded-[22px] border border-black/6 bg-[#1a7349] px-4 py-4 text-white transition-colors hover:bg-[#17663f] dark:border-white/10 dark:bg-emerald-500 dark:text-[#08130f] dark:hover:bg-emerald-400"
                      >
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-80">主入口</div>
                        <div className="mt-2 text-sm font-semibold">打开看板</div>
                      </Link>
                      <Link
                        href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}` : "/"}
                        className="rounded-[22px] border border-black/6 bg-white/84 px-4 py-4 text-slate-900 transition-colors hover:bg-white dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100 dark:hover:bg-white/[0.1]"
                      >
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">概览</div>
                        <div className="mt-2 text-sm font-semibold">工作区概览</div>
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsInitialTab(undefined);
                          setShowSettingsPanel(true);
                        }}
                        className="rounded-[22px] border border-black/6 bg-white/56 px-4 py-4 text-left text-slate-900 transition-colors hover:bg-white/86 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100 dark:hover:bg-white/[0.08]"
                      >
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">设置</div>
                        <div className="mt-2 text-sm font-semibold">系统设置</div>
                      </button>
                    </div>
                  </div>
                </section>

                <section className="rounded-[32px] border border-black/5 bg-white/82 p-5 shadow-[0_24px_70px_-52px_rgba(15,23,42,0.4)] dark:border-white/8 dark:bg-[#111827]/84">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#728197] dark:text-slate-500">
                        最近看板
                      </div>
                      <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        从正在推进的看板继续。
                      </div>
                    </div>
                    <Link
                      href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}/kanban` : "/"}
                      className="rounded-full border border-black/8 bg-white/85 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700 transition-colors hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
                    >
                      查看全部
                    </Link>
                  </div>

                  {workspaceHomeLoading && activeData.boards.length === 0 ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {Array.from({ length: 3 }).map((_, index) => (
                        <div key={index} className="h-40 animate-pulse rounded-[24px] border border-black/6 bg-[#f3f0e8] dark:border-white/8 dark:bg-white/[0.04]" />
                      ))}
                    </div>
                  ) : sortedBoards.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {sortedBoards.slice(0, 6).map((board, index) => {
                        const taskCount = sortedTasks.filter((task) => task.boardId === board.id).length;
                        const runningCount = sortedTasks.filter((task) => task.boardId === board.id && task.status === "IN_PROGRESS").length;

                        return (
                          <Link
                            key={board.id}
                            href={`/workspace/${board.workspaceId}/kanban`}
                            className={`group rounded-[26px] border p-4 transition-all hover:-translate-y-0.5 hover:shadow-[0_26px_60px_-40px_rgba(15,23,42,0.45)] ${
                              index === 0
                                ? "border-[#9fc690] bg-[linear-gradient(180deg,#eef6ea_0%,#e4efdd_100%)] dark:border-emerald-800/40 dark:bg-[linear-gradient(180deg,rgba(16,185,129,0.12),rgba(17,24,39,0.75))]"
                                : "border-black/6 bg-[#f9f8f3] dark:border-white/8 dark:bg-white/[0.03]"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                  看板 {String(index + 1).padStart(2, "0")}
                                </div>
                                <div className="mt-2 truncate text-lg font-semibold text-[#11151a] dark:text-slate-100">
                                  {board.name}
                                </div>
                              </div>
                              <span className="rounded-full border border-black/6 bg-white/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300">
                                {taskCount} 张卡片
                              </span>
                            </div>

                            <div className="mt-6 grid grid-cols-2 gap-2">
                              <div className="rounded-[18px] border border-black/6 bg-white/80 px-3 py-2 dark:border-white/8 dark:bg-white/[0.03]">
                                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">进行中</div>
                                <div className="mt-1 text-sm font-semibold text-[#11151a] dark:text-slate-100">{runningCount}</div>
                              </div>
                              <div className="rounded-[18px] border border-black/6 bg-white/80 px-3 py-2 dark:border-white/8 dark:bg-white/[0.03]">
                                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">最近更新</div>
                                <div className="mt-1 text-sm font-semibold text-[#11151a] dark:text-slate-100">{formatRelativeTime(board.updatedAt ?? board.createdAt)}</div>
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-[26px] border border-dashed border-black/10 bg-[#f8f5ee] px-5 py-10 text-center dark:border-white/10 dark:bg-white/[0.03]">
                      <div className="text-lg font-semibold text-[#11151a] dark:text-slate-100">
                        还没有看板
                      </div>
                      <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        先进入看板页，为这个工作区创建第一个看板。
                      </div>
                      <Link
                        href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}/kanban` : "/"}
                        className="mt-5 inline-flex rounded-full bg-[#1a7349] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#17663f] dark:bg-emerald-500 dark:text-[#08130f] dark:hover:bg-emerald-400"
                      >
                        打开看板
                      </Link>
                    </div>
                  )}
                </section>
              </section>

              <aside className="space-y-4">
                <section className="rounded-[28px] border border-black/5 bg-white/82 p-4 shadow-[0_24px_70px_-52px_rgba(15,23,42,0.45)] dark:border-white/8 dark:bg-[#111827]/84">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#728197] dark:text-slate-500">
                    最近卡片
                  </div>
                  <div className="mt-4 space-y-2">
                    {sortedTasks.slice(0, 6).map((task) => (
                      <Link
                        key={task.id}
                        href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}/kanban` : "/"}
                        className="block rounded-[22px] border border-black/6 bg-[#faf8f1] p-3 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-[#11151a] dark:text-slate-100">
                              {task.title}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                              {task.boardId ? `看板 ${task.boardId.slice(0, 6)}` : "未分配看板"} · {formatRelativeTime(task.updatedAt ?? task.createdAt)}
                            </div>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${getTaskTone(task)}`}>
                            {task.columnId ?? task.status}
                          </span>
                        </div>
                      </Link>
                    ))}
                    {sortedTasks.length === 0 && (
                      <div className="rounded-[22px] border border-dashed border-black/10 px-4 py-8 text-center text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                        这个工作区里还没有卡片。
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-[28px] border border-black/5 bg-white/82 p-4 shadow-[0_24px_70px_-52px_rgba(15,23,42,0.45)] dark:border-white/8 dark:bg-[#111827]/84">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#728197] dark:text-slate-500">
                    继续上次工作
                  </div>
                  <div className="mt-4 space-y-2">
                    {recentSessions.map((session) => (
                      <Link
                        key={session.sessionId}
                        href={`/workspace/${session.workspaceId}/sessions/${session.sessionId}`}
                        className="block rounded-[22px] border border-black/6 bg-[#faf8f1] p-3 transition-colors hover:bg-white dark:border-white/8 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                      >
                        <div className="text-sm font-semibold text-[#11151a] dark:text-slate-100">
                          {getSessionLabel(session)}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                          {session.role ? `${session.role} · ` : ""}{formatRelativeTime(session.createdAt)}
                        </div>
                      </Link>
                    ))}
                    {recentSessions.length === 0 && (
                      <div className="rounded-[22px] border border-dashed border-black/10 px-4 py-8 text-center text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                        卡片开始执行后，最近会话会显示在这里。
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-[28px] border border-black/5 bg-[linear-gradient(180deg,#f8f5ee_0%,#efe9dc_100%)] p-4 shadow-[0_24px_70px_-52px_rgba(15,23,42,0.45)] dark:border-white/8 dark:bg-[linear-gradient(180deg,#111827_0%,#1a2335_100%)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#728197] dark:text-slate-500">
                    快捷入口
                  </div>
                  <div className="mt-4 grid gap-2">
                    <Link
                      href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}/kanban` : "/"}
                      className="rounded-[20px] border border-black/6 bg-white/84 px-4 py-3 text-sm font-semibold text-[#11151a] transition-colors hover:bg-white dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-100 dark:hover:bg-white/[0.1]"
                    >
                      打开看板视图
                    </Link>
                    <Link
                      href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}` : "/"}
                      className="rounded-[20px] border border-black/6 bg-white/60 px-4 py-3 text-sm font-semibold text-[#11151a] transition-colors hover:bg-white/90 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100 dark:hover:bg-white/[0.08]"
                    >
                      工作区概览
                    </Link>
                  </div>
                </section>
              </aside>
            </div>
          )}
        </main>

        <SettingsPanel
          open={showSettingsPanel}
          onClose={() => setShowSettingsPanel(false)}
          providers={acp.providers}
          initialTab={settingsInitialTab}
          onResetOnboarding={handleResetOnboarding}
        />
      </div>
    </NotificationProvider>
  );
}
