import { expect, test, type Page } from "@playwright/test";

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

async function openDesktopRoute(page: Page, path: string, colorScheme: "light" | "dark") {
  await page.emulateMedia({ colorScheme });
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  await page.addStyleTag({
    content: `
      [data-testid="workspace-tab-count"],
      [data-testid="kanban-task-count"],
      [data-testid="traces-selected-session"] {
        visibility: hidden !important;
      }
    `,
  });
}

test.describe("Desktop Shell Visual Regression", () => {
  test.setTimeout(60_000);

  for (const colorScheme of ["light", "dark"] as const) {
    test(`workspace shell chrome (${colorScheme})`, async ({ page }) => {
      await openDesktopRoute(page, "/workspace/default", colorScheme);

      await expect(page.getByTestId("desktop-shell-root")).toBeVisible();
      await expect(page.getByTestId("desktop-shell-header")).toHaveScreenshot(
        `workspace-shell-header-${colorScheme}.png`,
        { animations: "disabled" },
      );
      await expect(page.getByTestId("desktop-shell-sidebar")).toHaveScreenshot(
        `workspace-shell-sidebar-${colorScheme}.png`,
        { animations: "disabled" },
      );
      await expect(page.getByTestId("workspace-tab-bar")).toHaveScreenshot(
        `workspace-tab-bar-${colorScheme}.png`,
        { animations: "disabled" },
      );
    });

    test(`kanban page header (${colorScheme})`, async ({ page }) => {
      await openDesktopRoute(page, "/workspace/default/kanban", colorScheme);

      await expect(page.getByTestId("desktop-shell-root")).toBeVisible();
      await expect(page.getByTestId("kanban-page-header")).toHaveScreenshot(
        `kanban-page-header-${colorScheme}.png`,
        { animations: "disabled" },
      );
    });

    test(`traces shell chrome (${colorScheme})`, async ({ page }) => {
      await openDesktopRoute(page, "/traces", colorScheme);

      await expect(page.getByTestId("desktop-shell-root")).toBeVisible();
      await expect(page.getByTestId("traces-page-header")).toHaveScreenshot(
        `traces-page-header-${colorScheme}.png`,
        { animations: "disabled" },
      );
      await expect(page.getByTestId("traces-view-tabs")).toHaveScreenshot(
        `traces-view-tabs-${colorScheme}.png`,
        { animations: "disabled" },
      );
    });
  }
});
