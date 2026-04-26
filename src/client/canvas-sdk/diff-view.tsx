"use client";

import type { CSSProperties, JSX } from "react";

import { useHostTheme } from "./theme-context";
import { mergeStyle } from "./primitives";

export type DiffStatsProps = {
  additions?: number;
  deletions?: number;
  style?: CSSProperties;
};

export function DiffStats({
  additions = 0,
  deletions = 0,
  style,
}: DiffStatsProps): JSX.Element | null {
  const { palette } = useHostTheme();
  if (additions <= 0 && deletions <= 0) {
    return null;
  }

  return (
    <span
      style={mergeStyle(
        {
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
          lineHeight: "16px",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        },
        style,
      )}
    >
      {additions > 0 ? <span style={{ color: palette.success }}>+{additions}</span> : null}
      {deletions > 0 ? <span style={{ color: palette.danger }}>-{deletions}</span> : null}
    </span>
  );
}

export type DiffLineType = "added" | "removed" | "unchanged";

export type DiffLineData = {
  type: DiffLineType;
  content: string;
  lineNumber?: number;
};

export type DiffViewProps = {
  lines: DiffLineData[];
  path?: string;
  language?: string;
  showLineNumbers?: boolean;
  coloredLineNumbers?: boolean;
  showAccentStrip?: boolean;
  style?: CSSProperties;
};

function inferLanguageFromPath(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  const basename = path.split("/").at(-1);
  if (!basename || !basename.includes(".")) {
    return undefined;
  }
  const extension = basename.split(".").at(-1)?.toLowerCase();
  if (!extension) {
    return undefined;
  }

  const aliases: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    json: "json",
    jsonc: "jsonc",
    yml: "yaml",
    yaml: "yaml",
    md: "markdown",
    sh: "shell",
    zsh: "shell",
    css: "css",
    html: "html",
    sql: "sql",
  };

  return aliases[extension] ?? extension;
}

function lineBackground(type: DiffLineType, tokens: ReturnType<typeof useHostTheme>["tokens"]): string {
  if (type === "added") {
    return tokens.diff.insertedLine;
  }
  if (type === "removed") {
    return tokens.diff.removedLine;
  }
  return "transparent";
}

function accentColor(type: DiffLineType, tokens: ReturnType<typeof useHostTheme>["tokens"]): string {
  if (type === "added") {
    return tokens.diff.stripAdded;
  }
  if (type === "removed") {
    return tokens.diff.stripRemoved;
  }
  return "transparent";
}

function gutterColor(
  type: DiffLineType,
  colored: boolean,
  theme: ReturnType<typeof useHostTheme>,
): string {
  if (!colored || type === "unchanged") {
    return theme.tokens.text.tertiary;
  }
  return type === "added" ? theme.palette.success : theme.palette.danger;
}

export function DiffView({
  lines,
  path,
  language,
  showLineNumbers = true,
  coloredLineNumbers = true,
  showAccentStrip = true,
  style,
}: DiffViewProps): JSX.Element {
  const theme = useHostTheme();
  const resolvedLanguage = language ?? inferLanguageFromPath(path);

  return (
    <div
      aria-label={path ? `Diff for ${path}` : "Diff"}
      data-language={resolvedLanguage}
      style={mergeStyle(
        {
          boxSizing: "border-box",
          width: "100%",
          minWidth: 0,
          overflow: "auto",
          background: theme.tokens.bg.editor,
          color: theme.tokens.text.primary,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          lineHeight: "20px",
          tabSize: 4,
        },
        style,
      )}
    >
      <div style={{ minWidth: "100%", width: "max-content", paddingBlock: 2 }}>
        {lines.map((line, index) => (
          <div
            key={`${index}-${line.type}-${line.lineNumber ?? "none"}`}
            style={{
              display: "flex",
              minHeight: 20,
              background: lineBackground(line.type, theme.tokens),
            }}
          >
            {showAccentStrip ? (
              <span
                aria-hidden="true"
                style={{
                  flex: "0 0 3px",
                  background: accentColor(line.type, theme.tokens),
                }}
              />
            ) : null}
            {showLineNumbers ? (
              <span
                aria-hidden="true"
                style={{
                  flex: "0 0 4ch",
                  paddingInline: "8px 6px",
                  textAlign: "right",
                  color: gutterColor(line.type, coloredLineNumbers, theme),
                  userSelect: "none",
                  fontVariantNumeric: "tabular-nums",
                  borderRight: `1px solid ${theme.tokens.stroke.tertiary}`,
                }}
              >
                {line.lineNumber ?? ""}
              </span>
            ) : null}
            <span
              style={{
                display: "block",
                whiteSpace: "pre",
                paddingLeft: 8,
                paddingRight: 12,
                color: theme.tokens.text.primary,
              }}
            >
              {line.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
