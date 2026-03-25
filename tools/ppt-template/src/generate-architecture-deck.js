#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadRoutaTokens, pickTextColor } from "./color-tokens.mjs";
import {
  addBody,
  addBulletList,
  addCard,
  addFullBleed,
  addHeadline,
  addKicker,
  addSectionTitle,
  createDeck,
  ensureDir,
  fileExists,
  readJson,
  resolveOutputPath,
} from "./ppt-theme.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(toolRoot, "..", "..");
const architectureDocPath = path.join(repoRoot, "docs", "ARCHITECTURE.md");
const featureTreePath = path.join(repoRoot, "docs", "product-specs", "FEATURE_TREE.md");
const outputDir = resolveOutputPath(toolRoot);
const outputFile = resolveOutputPath(toolRoot, "routa-architecture-deck.pptx");
const screenshotsDir = resolveOutputPath(toolRoot, "screenshots");
const screenshotManifestPath = path.join(screenshotsDir, "manifest.json");

const tokens = loadRoutaTokens();
const pptx = createDeck({
  title: "Routa Architecture Deck",
  subject: "Architecture overview, routes, and screenshots",
  lang: "en-US",
});
const shapeType = pptx.ShapeType;

function extractBulletSection(source, heading) {
  const marker = `## ${heading}`;
  const after = source.split(marker)[1] ?? "";
  const block = after.split("\n## ")[0];
  return block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).replace(/`/g, "").trim());
}

function extractTableRows(source, heading) {
  const marker = `## ${heading}`;
  const after = source.split(marker)[1] ?? "";
  const block = after.split("\n## ")[0];
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !line.includes("---"));

  return lines.slice(1).map((line) =>
    line
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function extractRuntimeTopology(source) {
  const marker = "## Runtime Topology";
  const after = source.split(marker)[1] ?? "";
  const block = after.split("\n## ")[0];
  return {
    web: block
      .split("### Web Runtime")[1]
      ?.split("### Desktop Runtime")[0]
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).replace(/`/g, "").trim()) ?? [],
    desktop: block
      .split("### Desktop Runtime")[1]
      ?.split("## Shared Architecture Model")[0]
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).replace(/`/g, "").trim()) ?? [],
  };
}

function extractSharedModel(source) {
  const marker = "## Shared Architecture Model";
  const after = source.split(marker)[1] ?? "";
  const block = after.split("```text")[1]?.split("```")[0] ?? "";
  return block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractFeatureRoutes(source) {
  const desired = new Set(["/", "/workspace/:workspaceId", "/workspace/:workspaceId/kanban", "/workspace/:workspaceId/team", "/traces", "/settings"]);
  const lines = source.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((part) => part.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    if (desired.has(cells[1])) {
      rows.push({ page: cells[0], route: cells[1], description: cells[2] });
    }
  }
  return rows;
}

function loadArchitectureData() {
  const architectureSource = fs.readFileSync(architectureDocPath, "utf8");
  const featureSource = fs.readFileSync(featureTreePath, "utf8");
  return {
    principles: extractBulletSection(architectureSource, "Core Principles"),
    repositoryShape: extractTableRows(architectureSource, "Repository Shape").map(([area, purpose]) => ({ area, purpose })),
    protocolStack: extractTableRows(architectureSource, "Protocol Stack").map(([protocol, endpoints, role]) => ({
      protocol,
      endpoints,
      role,
    })),
    runtimeTopology: extractRuntimeTopology(architectureSource),
    sharedModel: extractSharedModel(architectureSource),
    featureRoutes: extractFeatureRoutes(featureSource),
  };
}

function loadScreenshots() {
  return readJson(screenshotManifestPath, []);
}

function addCoverSlide() {
  const slide = pptx.addSlide();
  const dark = tokens.desktop.dark;
  addFullBleed(slide, shapeType, dark["--dt-bg-primary"]);

  slide.addShape(shapeType.arc, {
    x: 8.5,
    y: -0.7,
    w: 4.6,
    h: 3.1,
    line: { color: dark["--dt-brand-blue"], transparency: 100 },
    fill: { color: dark["--dt-brand-blue"], transparency: 24 },
  });
  slide.addShape(shapeType.arc, {
    x: 7.6,
    y: 4.1,
    w: 5.1,
    h: 3,
    line: { color: dark["--dt-brand-green"], transparency: 100 },
    fill: { color: dark["--dt-brand-green"], transparency: 20 },
  });
  slide.addShape(shapeType.arc, {
    x: 9.6,
    y: 1.1,
    w: 3.2,
    h: 2.1,
    line: { color: dark["--dt-brand-orange"], transparency: 100 },
    fill: { color: dark["--dt-brand-orange"], transparency: 18 },
  });

  addKicker(slide, "architecture deck", dark["--dt-brand-blue-soft"], 0.8, 0.8, 2.7);
  addHeadline(slide, "Routa.js System Architecture", dark["--dt-text-primary"], 0.8, 1.2, 6.8, 0.75, 25);
  addBody(
    slide,
    "Workspace-first coordination, dual-backend parity, protocol adapters, and screenshot-backed product evidence.",
    dark["--dt-text-secondary"],
    0.8,
    2.2,
    6,
    0.55,
    11,
  );

  const pills = [
    { label: "Next.js + Rust", color: dark["--dt-brand-blue"] },
    { label: "ACP / MCP / A2A / SSE", color: dark["--dt-brand-orange"] },
    { label: "Workspace-first", color: dark["--dt-brand-green"] },
  ];
  pills.forEach((pill, index) => {
    slide.addShape(shapeType.roundRect, {
      x: 0.82 + index * 2.05,
      y: 4.95,
      w: 1.78,
      h: 0.44,
      rectRadius: 0.12,
      line: { color: pill.color, transparency: 100 },
      fill: { color: pill.color },
    });
    slide.addText(pill.label, {
      x: 0.98 + index * 2.05,
      y: 5.07,
      w: 1.45,
      h: 0.14,
      fontSize: 8.4,
      color: pickTextColor(pill.color),
      margin: 0,
    });
  });
}

function addPrinciplesSlide(data) {
  const slide = pptx.addSlide();
  const light = tokens.desktop.light;
  addFullBleed(slide, shapeType, light["--dt-bg-primary"]);
  addSectionTitle(slide, {
    eyebrow: "Core Principles",
    title: "Stable architecture invariants",
    body: "The durable rules in docs/ARCHITECTURE.md are better slide anchors than route-by-route implementation detail.",
    theme: {
      kicker: light["--dt-brand-blue"],
      title: light["--dt-text-primary"],
      body: light["--dt-text-secondary"],
    },
  });

  addCard(slide, shapeType, {
    x: 0.78, y: 2.1, w: 5.7, h: 4.9,
    line: { color: light["--dt-border"] },
    fill: { color: "FFFFFF" },
  });
  addBulletList(slide, shapeType, data.principles, {
    x: 1.05,
    y: 2.5,
    w: 5,
    bulletColor: light["--dt-brand-blue"],
    textColor: light["--dt-text-secondary"],
    fontSize: 10,
    lineGap: 0.72,
  });

  addCard(slide, shapeType, {
    x: 6.9, y: 2.1, w: 5.6, h: 4.9,
    line: { color: light["--dt-border-light"] },
    fill: { color: light["--dt-bg-secondary"] },
  });
  addHeadline(slide, "Layered execution model", light["--dt-text-primary"], 7.18, 2.42, 2.6, 0.25, 12);
  const modelBoxes = [
    { label: "Presentation", color: light["--dt-brand-blue"] },
    { label: "API / Transport", color: light["--dt-brand-orange"] },
    { label: "Protocol Adapters", color: light["--dt-brand-purple"] },
    { label: "Domain Services", color: light["--dt-brand-green"] },
    { label: "Stores / Runtime", color: light["--dt-brand-gray"] },
  ];
  modelBoxes.forEach((box, index) => {
    addCard(slide, shapeType, {
      x: 7.2,
      y: 2.95 + index * 0.72,
      w: 4.85,
      h: 0.42,
      line: { color: box.color, transparency: 100 },
      fill: { color: box.color },
      radius: 0.1,
    });
    slide.addText(box.label, {
      x: 7.38,
      y: 3.07 + index * 0.72,
      w: 2.8,
      h: 0.14,
      fontSize: 9,
      color: pickTextColor(box.color),
      margin: 0,
    });
  });
}

function addTopologySlide(data) {
  const slide = pptx.addSlide();
  const light = tokens.desktop.light;
  addFullBleed(slide, shapeType, light["--dt-bg-secondary"]);
  addSectionTitle(slide, {
    eyebrow: "Runtime Topology",
    title: "Web and desktop share domain semantics",
    body: "The deployment model changes, but the product vocabulary and behavior should stay aligned.",
    theme: {
      kicker: light["--dt-brand-orange"],
      title: light["--dt-text-primary"],
      body: light["--dt-text-secondary"],
    },
  });

  const panels = [
    { x: 0.78, title: "Web Runtime", color: light["--dt-brand-blue"], bullets: data.runtimeTopology.web },
    { x: 6.72, title: "Desktop Runtime", color: light["--dt-brand-green"], bullets: data.runtimeTopology.desktop },
  ];

  panels.forEach((panel) => {
    addCard(slide, shapeType, {
      x: panel.x,
      y: 2.05,
      w: 5.8,
      h: 4.95,
      line: { color: light["--dt-border"] },
      fill: { color: "FFFFFF" },
    });
    slide.addShape(shapeType.rect, {
      x: panel.x,
      y: 2.05,
      w: 5.8,
      h: 0.18,
      line: { color: panel.color, transparency: 100 },
      fill: { color: panel.color },
    });
    addHeadline(slide, panel.title, light["--dt-text-primary"], panel.x + 0.28, 2.38, 2.2, 0.24, 12);
    addBulletList(slide, shapeType, panel.bullets, {
      x: panel.x + 0.28,
      y: 2.82,
      w: 4.95,
      bulletColor: panel.color,
      textColor: light["--dt-text-secondary"],
      fontSize: 9,
      lineGap: 0.68,
    });
  });
}

function addRepositorySlide(data) {
  const slide = pptx.addSlide();
  const light = tokens.desktop.light;
  addFullBleed(slide, shapeType, light["--dt-bg-primary"]);
  addSectionTitle(slide, {
    eyebrow: "Repository Shape",
    title: "Codebase layout by responsibility",
    body: "This is the simplest architecture slide for onboarding: one row, one boundary, one purpose.",
    theme: {
      kicker: light["--dt-brand-green"],
      title: light["--dt-text-primary"],
      body: light["--dt-text-secondary"],
    },
  });

  data.repositoryShape.slice(0, 8).forEach((row, index) => {
    const y = 2.1 + index * 0.58;
    const fill = index % 2 === 0 ? "FFFFFF" : light["--dt-bg-secondary"];
    addCard(slide, shapeType, {
      x: 0.78, y, w: 12, h: 0.42,
      line: { color: light["--dt-border-light"] },
      fill: { color: fill },
      radius: 0.03,
    });
    slide.addText(row.area, {
      x: 1.02, y: y + 0.11, w: 2.8, h: 0.14,
      fontSize: 8.8, bold: true, color: light["--dt-text-primary"], margin: 0,
    });
    slide.addText(row.purpose, {
      x: 3.3, y: y + 0.11, w: 8.8, h: 0.14,
      fontSize: 8.8, color: light["--dt-text-secondary"], margin: 0,
    });
  });

  addCard(slide, shapeType, {
    x: 8.55, y: 6.15, w: 4.23, h: 0.72,
    line: { color: light["--dt-brand-blue"], transparency: 85 },
    fill: { color: light["--dt-bg-active"] },
  });
  slide.addText("Tip: this table works well as a recurring appendix slide in architecture reviews.", {
    x: 8.78, y: 6.37, w: 3.8, h: 0.18,
    fontSize: 8.3, color: light["--dt-text-secondary"], margin: 0,
  });
}

function addProtocolSlide(data) {
  const slide = pptx.addSlide();
  const dark = tokens.desktop.dark;
  addFullBleed(slide, shapeType, dark["--dt-bg-primary"]);
  addSectionTitle(slide, {
    eyebrow: "Protocol Stack",
    title: "Integration surfaces are first-class",
    body: "REST is only one layer. ACP, MCP, A2A, AG-UI, A2UI, and SSE all sit inside the product model.",
    theme: {
      kicker: dark["--dt-brand-blue-soft"],
      title: dark["--dt-text-primary"],
      body: dark["--dt-text-secondary"],
    },
  });

  data.protocolStack.slice(0, 6).forEach((row, index) => {
    const y = 2.15 + index * 0.77;
    const accentColors = [
      dark["--dt-brand-blue"],
      dark["--dt-brand-orange"],
      dark["--dt-brand-green"],
      dark["--dt-brand-purple"],
      dark["--dt-brand-route"],
      dark["--dt-brand-red"],
    ];
    const accent = accentColors[index % accentColors.length];
    addCard(slide, shapeType, {
      x: 0.78, y, w: 12, h: 0.58,
      line: { color: dark["--dt-border"] },
      fill: { color: dark["--dt-bg-secondary"] },
    });
    addCard(slide, shapeType, {
      x: 0.94, y: y + 0.09, w: 1.35, h: 0.4,
      line: { color: accent, transparency: 100 },
      fill: { color: accent },
      radius: 0.12,
    });
    slide.addText(row.protocol, {
      x: 1.12, y: y + 0.22, w: 1, h: 0.12,
      fontSize: 8.8, color: pickTextColor(accent), bold: true, margin: 0,
    });
    slide.addText(row.endpoints, {
      x: 2.55, y: y + 0.15, w: 3.4, h: 0.14,
      fontSize: 8.4, color: dark["--dt-text-primary"], margin: 0,
    });
    slide.addText(row.role, {
      x: 6.05, y: y + 0.15, w: 6, h: 0.18,
      fontSize: 8.4, color: dark["--dt-text-secondary"], margin: 0,
    });
  });
}

function addRoutesAndScreenshotsSlide(data, screenshots) {
  const slide = pptx.addSlide();
  const light = tokens.desktop.light;
  addFullBleed(slide, shapeType, light["--dt-bg-secondary"]);
  addSectionTitle(slide, {
    eyebrow: "Routes And Evidence",
    title: "Product routes ready for capture",
    body: "The deck can mix generated architecture slides with live screenshots captured by agent-browser.",
    theme: {
      kicker: light["--dt-brand-purple"],
      title: light["--dt-text-primary"],
      body: light["--dt-text-secondary"],
    },
  });

  addCard(slide, shapeType, {
    x: 0.78, y: 2.05, w: 4.2, h: 4.95,
    line: { color: light["--dt-border"] },
    fill: { color: "FFFFFF" },
  });
  addHeadline(slide, "Key routes", light["--dt-text-primary"], 1.04, 2.32, 1.6, 0.2, 11);
  data.featureRoutes.forEach((route, index) => {
    slide.addText(`${route.route}`, {
      x: 1.04, y: 2.72 + index * 0.7, w: 2.7, h: 0.15,
      fontSize: 8.5, bold: true, color: light["--dt-brand-blue"], margin: 0,
    });
    slide.addText(route.page, {
      x: 1.04, y: 2.9 + index * 0.7, w: 2.7, h: 0.14,
      fontSize: 8.3, color: light["--dt-text-primary"], margin: 0,
    });
    slide.addText(route.description, {
      x: 1.04, y: 3.08 + index * 0.7, w: 3.35, h: 0.18,
      fontSize: 7.6, color: light["--dt-text-muted"], margin: 0,
    });
  });

  const screenshotSlots = screenshots.slice(0, 2);
  screenshotSlots.forEach((entry, index) => {
    const x = 5.35 + index * 3.75;
    addCard(slide, shapeType, {
      x, y: 2.15, w: 3.45, h: 3.85,
      line: { color: light["--dt-border"] },
      fill: { color: "FFFFFF" },
    });
    if (fileExists(entry.file)) {
      slide.addImage({
        path: entry.file,
        x: x + 0.12,
        y: 2.27,
        w: 3.21,
        h: 2.38,
      });
    } else {
      addCard(slide, shapeType, {
        x: x + 0.12, y: 2.27, w: 3.21, h: 2.38,
        line: { color: light["--dt-border-light"] },
        fill: { color: light["--dt-bg-tertiary"] },
      });
      slide.addText("Missing screenshot", {
        x: x + 0.9, y: 3.25, w: 1.6, h: 0.14,
        fontSize: 9, color: light["--dt-text-muted"], margin: 0,
      });
    }
    slide.addText(entry.id, {
      x: x + 0.14, y: 4.92, w: 1.4, h: 0.15,
      fontSize: 8.6, bold: true, color: light["--dt-text-primary"], margin: 0,
    });
    slide.addText(entry.description || entry.route, {
      x: x + 0.14, y: 5.14, w: 2.95, h: 0.24,
      fontSize: 7.6, color: light["--dt-text-secondary"], margin: 0,
    });
  });

  if (screenshotSlots.length === 0) {
    addCard(slide, shapeType, {
      x: 5.35, y: 2.15, w: 7.45, h: 3.85,
      line: { color: light["--dt-border-light"] },
      fill: { color: light["--dt-bg-primary"] },
    });
    slide.addText("No screenshots found yet", {
      x: 7.85, y: 3.45, w: 2.6, h: 0.2,
      fontSize: 12, bold: true, color: light["--dt-text-primary"], margin: 0,
    });
    slide.addText("Run `npm run capture:screenshots` inside tools/ppt-template to populate this slide.", {
      x: 6.45, y: 3.82, w: 5.15, h: 0.18,
      fontSize: 8.5, color: light["--dt-text-secondary"], margin: 0,
    });
  }
}

async function main() {
  ensureDir(outputDir);
  const data = loadArchitectureData();
  const screenshots = loadScreenshots();

  addCoverSlide();
  addPrinciplesSlide(data);
  addTopologySlide(data);
  addRepositorySlide(data);
  addProtocolSlide(data);
  addRoutesAndScreenshotsSlide(data, screenshots);

  await pptx.writeFile({ fileName: outputFile });
  console.log(`Generated architecture deck: ${outputFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
