#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

const shellFiles = [
  "src/client/components/desktop-app-shell.tsx",
  "src/client/components/desktop-layout.tsx",
  "src/client/components/desktop-sidebar.tsx",
  "src/client/components/desktop-nav-rail.tsx",
];

const tokenPresenceFiles = [
  "src/client/components/workspace-switcher.tsx",
];

const desktopThemeFile = "src/app/styles/desktop-theme.css";
const violations = [];

const forbiddenColorPatterns = [
  {
    name: "hardcoded hex colors",
    pattern: /#[0-9a-fA-F]{3,8}\b/g,
  },
  {
    name: "rgb/rgba colors",
    pattern: /\brgba?\(/g,
  },
  {
    name: "tailwind bracket colors",
    pattern: /\b(?:bg|text|border|ring|fill|stroke)-\[(?:#[^\]]+|(?:rgb|rgba|hsl|hsla)\([^\]]+\)|var\([^\]]+\))\]/g,
  },
  {
    name: "tailwind palette classes",
    pattern: /\b(?:bg|text|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[0-9]{2,3})?(?:\/[0-9]{1,3})?\b/g,
  },
];

function readFile(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf-8");
}

function collectLineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

function addViolation(file, line, message) {
  violations.push(`${file}:${line} ${message}`);
}

for (const file of shellFiles) {
  const content = readFile(file);
  for (const rule of forbiddenColorPatterns) {
    for (const match of content.matchAll(rule.pattern)) {
      addViolation(file, collectLineNumber(content, match.index ?? 0), `forbidden ${rule.name}: ${match[0]}`);
    }
  }
}

for (const file of tokenPresenceFiles) {
  const content = readFile(file);
  const requiredTokens = ["bg-desktop-", "text-desktop-", "border-desktop-"];
  for (const token of requiredTokens) {
    if (!content.includes(token)) {
      addViolation(file, 1, `missing desktop token usage containing "${token}"`);
    }
  }
}

const desktopThemeContent = readFile(desktopThemeFile);
for (const match of desktopThemeContent.matchAll(/--[a-zA-Z0-9-]+\s*:/g)) {
  const variableName = match[0].replace(/\s*:$/, "");
  const allowed =
    variableName.startsWith("--dt-") ||
    variableName.startsWith("--color-desktop-");
  if (!allowed) {
    addViolation(
      desktopThemeFile,
      collectLineNumber(desktopThemeContent, match.index ?? 0),
      `unexpected CSS variable prefix: ${variableName}`,
    );
  }
}

if (violations.length > 0) {
  console.error("Design-system CSS lint failed.\n");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Design-system CSS lint passed.");
