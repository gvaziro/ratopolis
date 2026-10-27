import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Smoke run of the production build (v3 REP-2, K7), once per project (desktop 1440×900, phone 375×812, landscape
 * 812×375): a fresh colony, real clicks on the grate until the vagrants come, then a metro train from warning to the
 * haul card. Every stop checks that the page does not scroll sideways and saves e2e/__shots__/<project>-<stop>.png;
 * the run must not log a console error or throw. The game is driven through the dev handle window.__rr, which a
 * production build exposes only with `?dev` (store.devHandleAllowed); `slot=e2e` keeps the save apart.
 */

type Phase = "warn" | "rumble" | "catch" | "piles" | "taps" | "haul" | "done";

/** The slice of window.__rr (the zustand store) the suite touches. */
type RR = {
  getState(): {
    game: { rats: number; scene: { id: string; phase: Phase } | null };
    setSetting(key: string, value: unknown): void;
    devOpenZone(zone: string): void;
    devTrigger(id: string): void;
    scene(action: { a: string }): void;
  };
};

const GRATE = '[aria-label^="Решётка водостока"]';
const DIALOG = "[data-scene-dialog]";

/** Runs `fn` with the store in the page. */
function rr<T>(page: Page, fn: (st: ReturnType<RR["getState"]>) => T): Promise<T> {
  return page.evaluate(`(${fn.toString()})(window.__rr.getState())`) as Promise<T>;
}

function phase(page: Page): Promise<Phase | null> {
  return rr(page, (st) => st.game.scene?.phase ?? null);
}

/**
 * A stop: no horizontal overflow, then a screenshot. The width is the device's, not innerWidth: with isMobile a page
 * wider than the screen widens the layout viewport (innerWidth grew to 401 with a 400 px element at 375).
 */
async function stop(page: Page, info: TestInfo, name: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: (document.scrollingElement ?? document.documentElement).scrollWidth,
    innerWidth: window.innerWidth,
  }));
  const width = Math.min(innerWidth, page.viewportSize()!.width);
  expect(scrollWidth, `${name}: the page scrolls sideways`).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `e2e/__shots__/${info.project.name}-${name}.png` });
}

test("a fresh colony: grate clicks, vagrants, a metro train to the haul card", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await test.step("open a clean colony", async () => {
    await page.goto("/?dev&slot=e2e");
    await page.waitForFunction(() => "__rr" in window);
    await expect(page.locator(GRATE).first()).toBeVisible();
    await rr(page, (st) => st.setSetting("reducedMotion", true));
    await stop(page, info, "home");
  });

  await test.step("click the grate until the vagrants come", async () => {
    const grate = page.locator(GRATE).first();
    const box = await grate.boundingBox();
    expect(box, "the grate has a box").not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    // nothing lies over the grate's centre
    const hit = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('[aria-label^="Решётка водостока"]'), [x, y]);
    expect(hit, "elementFromPoint at the grate's centre hits the grate").toBe(true);
    // locator clicks re-check actionability each time: if something covers the grate, the error names it
    const centre = { x: box!.width / 2, y: box!.height / 2 };
    for (let i = 0; i < 15; i++) {
      await grate.click({ position: centre, timeout: 5_000 });
      await page.waitForTimeout(60);
    }
    const seen = await page.evaluate(
      ([px, py]) => {
        const g = (window as unknown as { __rr: { getState(): { game: { res: { crumbs: number }; stats: { clicks?: number } } } } }).__rr.getState().game;
        const el = document.elementFromPoint(px, py);
        return `crumbs=${g.res.crumbs.toFixed(1)} clicks=${g.stats.clicks ?? "?"} at-centre=${el?.tagName}.${(el?.getAttribute("class") ?? "").slice(0, 60)}`;
      },
      [x, y],
    );
    await expect.poll(() => rr(page, (st) => st.game.rats), { message: `vagrants arrive (${seen})`, timeout: 20_000 }).toBeGreaterThan(0);
    const tabs = page.getByRole("tablist", { name: "Разделы колонии" });
    await expect(tabs).toBeVisible();
    await expect(tabs).toBeInViewport({ ratio: 1 });
    await stop(page, info, "colony");
  });

  await test.step("a metro train: warning, catch", async () => {
    await rr(page, (st) => {
      st.devOpenZone("metro");
      st.devTrigger("metro_train");
    });
    const dialog = page.locator(DIALOG);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => rr(page, (st) => st.game.scene?.id ?? null)).toBe("metro_train");
    if (info.project.name === "landscape") {
      // SCN-5: on a phone held sideways the close-up takes the whole screen
      const vp = page.viewportSize()!;
      const r = (await dialog.boundingBox())!;
      const w = Math.min(r.x + r.width, vp.width) - Math.max(r.x, 0);
      const h = Math.min(r.y + r.height, vp.height) - Math.max(r.y, 0);
      expect((w * h) / (vp.width * vp.height), "the scene dialog covers the viewport").toBeGreaterThan(0.9);
    }
    await stop(page, info, "warn");
    await expect.poll(() => phase(page), { timeout: 20_000 }).toMatch(/^(rumble|catch)$/);
    await rr(page, (st) => st.scene({ a: "ready" })); // «По местам!» (a no-op once the catch has begun)
    await expect.poll(() => phase(page)).toBe("catch");
    await page.waitForTimeout(1500);
    await stop(page, info, "catch");
  });

  await test.step("the haul card, closed", async () => {
    await rr(page, (st) => st.scene({ a: "skip" }));
    await expect.poll(() => phase(page)).toBe("haul");
    const next = page.locator(DIALOG).getByRole("button", { name: "Дальше" });
    await expect(next).toBeVisible();
    await page.waitForTimeout(800);
    await stop(page, info, "haul");
    await next.click();
    await expect(page.locator(DIALOG)).toBeHidden();
    await expect.poll(() => rr(page, (st) => st.game.scene)).toBeNull();
    await stop(page, info, "after");
  });

  expect(errors, "console errors and page errors").toEqual([]);
});
