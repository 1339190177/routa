import fs from "node:fs";
import path from "node:path";
import PptxGenJS from "pptxgenjs";

export function createDeck({ title, subject, lang = "en-US" }) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "OpenAI Codex";
  pptx.company = "Routa";
  pptx.subject = subject;
  pptx.title = title;
  pptx.lang = lang;
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang,
  };
  return pptx;
}

export function addFullBleed(slide, shapeType, color) {
  slide.addShape(shapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    line: { color },
    fill: { color },
  });
}

export function addKicker(slide, text, color, x = 0.75, y = 0.5, w = 2.6) {
  slide.addText(text.toUpperCase(), {
    x,
    y,
    w,
    h: 0.2,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    charSpace: 1.4,
    color,
    margin: 0,
  });
}

export function addHeadline(slide, title, color, x = 0.75, y = 0.9, w = 7.2, h = 0.55, fontSize = 23) {
  slide.addText(title, {
    x,
    y,
    w,
    h,
    fontFace: "Aptos Display",
    fontSize,
    bold: true,
    color,
    margin: 0,
  });
}

export function addBody(slide, text, color, x = 0.75, y = 1.5, w = 6.4, h = 0.45, fontSize = 10.5) {
  slide.addText(text, {
    x,
    y,
    w,
    h,
    fontSize,
    color,
    margin: 0,
  });
}

export function addSectionTitle(slide, { eyebrow, title, body, theme }) {
  addKicker(slide, eyebrow, theme.kicker);
  addHeadline(slide, title, theme.title);
  if (body) {
    addBody(slide, body, theme.body);
  }
}

export function addBulletList(slide, shapeType, items, options) {
  const {
    x,
    y,
    w,
    bulletColor,
    textColor,
    fontSize = 11,
    lineGap = 0.48,
    maxItems = items.length,
  } = options;

  items.slice(0, maxItems).forEach((item, index) => {
    const top = y + index * lineGap;
    slide.addShape(shapeType.ellipse, {
      x,
      y: top + 0.06,
      w: 0.11,
      h: 0.11,
      line: { color: bulletColor, transparency: 100 },
      fill: { color: bulletColor },
    });
    slide.addText(item, {
      x: x + 0.22,
      y: top,
      w,
      h: 0.28,
      fontSize,
      color: textColor,
      margin: 0,
      breakLine: false,
    });
  });
}

export function addCard(slide, shapeType, options) {
  const {
    x,
    y,
    w,
    h,
    fill,
    line,
    radius = 0.08,
  } = options;
  slide.addShape(shapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: radius,
    line,
    fill,
  });
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function fileExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function readJson(filePath, fallback) {
  if (!fileExists(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function resolveOutputPath(toolRoot, ...segments) {
  return path.join(toolRoot, "output", ...segments);
}
