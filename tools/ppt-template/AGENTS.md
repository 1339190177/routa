# PPT Template Tool — Routa presentation generator based on PptxGenJS and Routa design tokens.

## Tool Overview

- This directory contains the standalone PowerPoint generation tool for Routa decks.
- Start with `package.json` for available generation entrypoints.
- Presentation source logic lives in `src/`.
- Generated `.pptx` artifacts are written to `output/`.

## Directory Map

- `package.json`: Local scripts and dependency boundary for `pptxgenjs`.
- `src/generate-template.mjs`: Generates the reusable Routa color-token-based template deck.
- `src/release-notes-to-ppt.js`: Generates the release-notes deck from `docs/releases/`.
- `src/color-tokens.mjs`: Loads and resolves Routa CSS variables from the main app theme.
- `output/`: Generated presentations. Treat as build artifacts unless the task explicitly targets them.

## Source Of Truth

- Treat `src/app/globals.css` in the repository root as the canonical token source for brand and semantic colors.
- `src/color-tokens.mjs` is the local adapter that converts app CSS variables into PPT-safe hex values.
- Do not duplicate palette definitions across multiple scripts when the value can be derived from `color-tokens.mjs`.
- Keep this `AGENTS.md` as an operating contract and index, not as a place for large design notes.

## Working Rules

- Prefer extending existing slide helpers instead of adding one-off inline layout code repeatedly.
- Keep slide generation scripts modular: theme/bootstrap, shared drawing helpers, and slide-specific composition should stay separable.
- When a script grows toward the repository file-size limit, refactor by workflow boundary first, not into generic `utils`.
- Preserve deterministic output paths unless the task explicitly asks for parameterization.
- Unless explicitly requested, do not add extra documentation beyond the local agent instructions files.

## Generation Entry Points

- `npm run generate`: Build the generic Routa template deck from color tokens.
- `npm run generate:release:v0.2.7`: Build the current release-notes deck from markdown.
- Run commands from `tools/ppt-template/` so local `package.json` resolution stays unambiguous.

## PPTX Workflow

- If editing or extending an existing deck, first inspect the current output and preserve its visual system before changing layout logic.
- If creating new slides without a template, use `pptxgenjs` and build slides from reusable helpers rather than ad hoc coordinates everywhere.
- Every slide needs a visual element: shape composition, grid, stat callout, icon treatment, or image area. Avoid plain title-plus-bullets slides.
- Do not create generic AI-looking slides. Pick a deliberate palette hierarchy, a repeated motif, and noticeable contrast between title/content slides.
- Do not add decorative accent lines under titles. Use spacing, blocks, or color fields instead.

## Design Constraints

- Use a dominant color plus limited support colors; do not give all colors equal weight.
- Favor left-aligned body copy and strong type-size contrast.
- Keep at least roughly `0.5"` outer margins and consistent internal spacing.
- Watch text-box padding when aligning text with shapes; `margin: 0` is often the correct fix in PptxGenJS text boxes.
- Prefer a small set of layout families across a deck, but do not repeat the exact same composition on every slide.

## QA Requirements

- Treat first render as draft quality. Assume there are layout issues until proven otherwise.
- After modifying slide-generating code, regenerate the deck and inspect the resulting `.pptx`.
- Run text extraction with `python -m markitdown output/<file>.pptx` when content fidelity matters.
- For visual QA, convert the deck to images or otherwise inspect slide renderings and look for overflow, overlap, clipping, uneven spacing, weak contrast, and leftover placeholders.
- Do at least one fix-and-verify cycle before considering the work done.

## Practical Checks

- Check generated files under `output/` and confirm the expected file was rewritten.
- If placeholders or template text may exist, search extracted text for obvious leftovers such as `xxxx`, `lorem`, `ipsum`, or template instructions.
- When changing token resolution, verify both light/dark-derived mappings still resolve to valid hex values.

## Command Reference

```bash
npm run generate
npm run generate:release:v0.2.7
python -m markitdown output/routa-color-template.pptx
python -m markitdown output/routa-v0.2.7-release-notes.pptx
```

## After Code Changes

- If you modify source files in this directory, run the affected generation script.
- Fix runtime errors before stopping.
- If the change affects layout or content, perform at least a basic QA pass on the generated deck.
