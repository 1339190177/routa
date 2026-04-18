"use client";

import { type ComponentProps } from "react";
import { FileText, FlaskConical, ImageIcon } from "lucide-react";

import { ChatPanel } from "@/client/components/chat-panel";
import { useTranslation } from "@/i18n";

import {
  AnalysisSessionDrawer,
  ApiPanel,
  ContextPanel,
  SessionAnalysisDrawer,
  ScreenshotPanel,
} from "./feature-explorer-inspector-panels";
import { GenerateFeatureTreeDrawer } from "./generate-feature-tree-drawer";
import type {
  AggregatedSelectionSession,
  FeatureDetail,
  InspectorTab,
} from "./types";
import type { ExplorerSurfaceItem } from "./surface-navigation";

type TranslationT = ReturnType<typeof useTranslation>["t"];

export function FeatureExplorerInspectorPane({
  inspectorTab,
  onSelectInspectorTab,
  featureDetail,
  selectedFileCount,
  selectedScopeSessions,
  selectedSurface,
  selectedSurfaceFeatureNames,
  onOpenSessionAnalysis,
  onRequestApi,
  t,
}: {
  inspectorTab: InspectorTab;
  onSelectInspectorTab: (tab: InspectorTab) => void;
  featureDetail: FeatureDetail | null;
  selectedFileCount: number;
  selectedScopeSessions: AggregatedSelectionSession[];
  selectedSurface: ExplorerSurfaceItem | null;
  selectedSurfaceFeatureNames: string[];
  onOpenSessionAnalysis: () => void;
  onRequestApi: (method: string, apiPath: string) => Promise<void>;
  t: TranslationT;
}) {
  return (
    <aside className="flex min-h-0 flex-col bg-desktop-bg-secondary/10">
      <div className="border-b border-desktop-border px-3 py-2">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {([
            { id: "context" as const, label: t.featureExplorer.contextTab, icon: FileText },
            { id: "screenshot" as const, label: t.featureExplorer.screenshotTab, icon: ImageIcon },
            { id: "api" as const, label: t.featureExplorer.apiTab, icon: FlaskConical },
          ]).map((tab) => {
            const Icon = tab.icon;
            const isScreenshot = tab.id === "screenshot";
            return (
              <button
                key={tab.id}
                onClick={() => (!isScreenshot ? onSelectInspectorTab(tab.id) : null)}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  inspectorTab === tab.id
                    ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
                    : isScreenshot
                      ? "cursor-not-allowed border-desktop-border bg-desktop-bg-primary/30 text-desktop-text-secondary/60"
                      : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {inspectorTab === "context" && (
          <ContextPanel
            featureDetail={featureDetail}
            selectedFileCount={selectedFileCount}
            selectedScopeSessions={selectedScopeSessions}
            selectedSurface={selectedSurface}
            selectedSurfaceFeatureNames={selectedSurfaceFeatureNames}
            onOpenSessionAnalysis={onOpenSessionAnalysis}
            t={t}
          />
        )}

        {inspectorTab === "screenshot" && (
          <ScreenshotPanel featureDetail={featureDetail} t={t} />
        )}

        {inspectorTab === "api" && (
          <ApiPanel
            featureDetail={featureDetail}
            t={t}
            onRequest={onRequestApi}
          />
        )}
      </div>
    </aside>
  );
}

export function FeatureExplorerDrawers({
  workspaceId,
  repoPath,
  generateOpen,
  onCloseGenerate,
  onGenerated,
  sessionAnalysisDrawerKey,
  sessionAnalysisOpen,
  selectedFilePaths,
  selectedScopeSessions,
  providers,
  selectedProvider,
  onProviderChange,
  isStartingSessionAnalysis,
  sessionAnalysisError,
  onCloseSessionAnalysis,
  onStartSessionAnalysis,
  analysisSessionPaneOpen,
  analysisSessionId,
  analysisSessionName,
  analysisSessionProviderName,
  analysisSessionProviderId,
  fallbackSelectedProvider,
  onCloseAnalysisSessionPane,
  acp,
  onEnsureAnalysisSession,
  onSelectAnalysisSession,
  repoSelection,
  codebases,
  t,
}: {
  workspaceId: string;
  repoPath?: string;
  generateOpen: boolean;
  onCloseGenerate: () => void;
  onGenerated: () => void;
  sessionAnalysisDrawerKey: string;
  sessionAnalysisOpen: boolean;
  selectedFilePaths: string[];
  selectedScopeSessions: AggregatedSelectionSession[];
  providers: ComponentProps<typeof SessionAnalysisDrawer>["providers"];
  selectedProvider: string;
  onProviderChange: (provider: string) => void;
  isStartingSessionAnalysis: boolean;
  sessionAnalysisError: string | null;
  onCloseSessionAnalysis: () => void;
  onStartSessionAnalysis: (sessions?: AggregatedSelectionSession[]) => Promise<void>;
  analysisSessionPaneOpen: boolean;
  analysisSessionId: string | null;
  analysisSessionName: string;
  analysisSessionProviderName: string;
  analysisSessionProviderId: string;
  fallbackSelectedProvider: string;
  onCloseAnalysisSessionPane: () => void;
  acp: ComponentProps<typeof ChatPanel>["acp"];
  onEnsureAnalysisSession: () => Promise<string | null>;
  onSelectAnalysisSession: (sessionId: string) => Promise<void>;
  repoSelection: ComponentProps<typeof ChatPanel>["repoSelection"];
  codebases: ComponentProps<typeof ChatPanel>["codebases"];
  t: TranslationT;
}) {
  return (
    <>
      <GenerateFeatureTreeDrawer
        open={generateOpen}
        workspaceId={workspaceId}
        repoPath={repoPath}
        onClose={onCloseGenerate}
        onGenerated={onGenerated}
      />

      <SessionAnalysisDrawer
        key={sessionAnalysisDrawerKey}
        open={sessionAnalysisOpen}
        selectedFilePaths={selectedFilePaths}
        selectedScopeSessions={selectedScopeSessions}
        providers={providers}
        selectedProvider={selectedProvider}
        onProviderChange={onProviderChange}
        isStartingSessionAnalysis={isStartingSessionAnalysis}
        sessionAnalysisError={sessionAnalysisError}
        onClose={onCloseSessionAnalysis}
        onStartSessionAnalysis={onStartSessionAnalysis}
        t={t}
      />

      <AnalysisSessionDrawer
        open={analysisSessionPaneOpen && Boolean(analysisSessionId)}
        title={analysisSessionName || t.featureExplorer.sessionAnalysisTitle}
        subtitle={`${analysisSessionProviderName || analysisSessionProviderId || fallbackSelectedProvider} · ${analysisSessionId ?? ""}`}
        detailHref={analysisSessionId
          ? `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(analysisSessionId)}`
          : undefined}
        onClose={onCloseAnalysisSessionPane}
        t={t}
      >
        {analysisSessionId ? (
          <ChatPanel
            acp={acp}
            activeSessionId={analysisSessionId}
            onEnsureSession={onEnsureAnalysisSession}
            onSelectSession={onSelectAnalysisSession}
            repoSelection={repoSelection}
            onRepoChange={() => {}}
            codebases={codebases}
            activeWorkspaceId={workspaceId}
            agentRole="ROUTA"
          />
        ) : null}
      </AnalysisSessionDrawer>
    </>
  );
}
