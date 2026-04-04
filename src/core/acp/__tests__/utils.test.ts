import { describe, expect, it } from "vitest";

import { needsShell, quoteShellCommandPath } from "../utils";

describe("needsShell", () => {
  it("returns true for .cmd files", () => {
    expect(needsShell("C:\\Program Files\\nodejs\\npx.cmd")).toBe(true);
    expect(needsShell("npx.cmd")).toBe(true);
    expect(needsShell("script.CMD")).toBe(true);
  });

  it("returns true for .bat files", () => {
    expect(needsShell("C:\\scripts\\build.bat")).toBe(true);
    expect(needsShell("test.bat")).toBe(true);
    expect(needsShell("SCRIPT.BAT")).toBe(true);
  });

  it("returns false for non-shell files", () => {
    expect(needsShell("C:\\Program Files\\nodejs\\node.exe")).toBe(false);
    expect(needsShell("/usr/bin/node")).toBe(false);
    expect(needsShell("script.sh")).toBe(false);
    expect(needsShell("program")).toBe(false);
  });
});

describe("quoteShellCommandPath", () => {
  describe("paths that should be quoted", () => {
    it("quotes .cmd paths with whitespace", () => {
      const path = "C:\\Program Files\\nodejs\\npx.cmd";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });

    it("quotes .bat paths with whitespace", () => {
      const path = "C:\\My Scripts\\build.bat";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });

    it("quotes .cmd paths with ampersand", () => {
      const path = "C:\\Users\\R&D\\AppData\\Roaming\\npm\\npx.cmd";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });

    it("quotes .cmd paths with parentheses", () => {
      const path = "C:\\Program Files (x86)\\Tool\\script.cmd";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });

    it("quotes .bat paths with caret", () => {
      const path = "C:\\Path^With^Caret\\script.bat";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });

    it("quotes .cmd paths with pipe", () => {
      const path = "C:\\Path|With|Pipe\\script.cmd";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });

    it("quotes .cmd paths with less/greater than", () => {
      expect(quoteShellCommandPath("C:\\Path<Test\\script.cmd")).toBe(
        '"C:\\Path<Test\\script.cmd"'
      );
      expect(quoteShellCommandPath("C:\\Path>Test\\script.cmd")).toBe(
        '"C:\\Path>Test\\script.cmd"'
      );
    });

    it("quotes .cmd paths without special characters for consistency", () => {
      // The enhancement suggests quoting all shell commands for robustness
      const path = "C:\\Users\\John\\AppData\\Roaming\\npm\\npx.cmd";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });
  });

  describe("paths that should not be quoted", () => {
    it("does not quote non-shell executables with whitespace", () => {
      const path = "C:\\Program Files\\nodejs\\node.exe";
      expect(quoteShellCommandPath(path)).toBe(path);
    });

    it("does not quote Unix paths", () => {
      const path = "/usr/local/bin/node";
      expect(quoteShellCommandPath(path)).toBe(path);
    });

    it("does not quote .sh files even with whitespace", () => {
      const path = "/home/user/my scripts/build.sh";
      expect(quoteShellCommandPath(path)).toBe(path);
    });
  });

  describe("already quoted paths", () => {
    it("does not double-quote already quoted .cmd paths", () => {
      const path = '"C:\\Program Files\\nodejs\\npx.cmd"';
      expect(quoteShellCommandPath(path)).toBe(path);
    });

    it("does not double-quote already quoted .bat paths", () => {
      const path = '"C:\\My Scripts\\build.bat"';
      expect(quoteShellCommandPath(path)).toBe(path);
    });

    it("handles paths with internal quotes correctly", () => {
      // Edge case: path already has quotes at start and end
      const quotedPath = '"C:\\Users\\R&D\\script.cmd"';
      expect(quoteShellCommandPath(quotedPath)).toBe(quotedPath);
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(quoteShellCommandPath("")).toBe("");
    });

    it("handles paths with mixed case extensions", () => {
      expect(quoteShellCommandPath("C:\\Path\\Script.Cmd")).toBe(
        '"C:\\Path\\Script.Cmd"'
      );
      expect(quoteShellCommandPath("C:\\Path\\Script.BaT")).toBe(
        '"C:\\Path\\Script.BaT"'
      );
    });

    it("handles paths with multiple special characters", () => {
      const path = "C:\\R&D (Test)\\App^Data\\script.cmd";
      expect(quoteShellCommandPath(path)).toBe(`"${path}"`);
    });
  });
});
