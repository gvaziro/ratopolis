import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Fast suite by default (`npm test`): every *.test.ts except *.slow.test.ts (the 3-hour sim reachability run and
 * other minute-long checks). Slow tests: `npm run test:slow` (--mode slow: only *.slow.test.ts), everything:
 * `npm run test:all` (--mode all) or SLOW=1 with any mode (CI's nightly balance job, REP-1).
 * testTimeout 20 s: the heavy scheduler cases take ~3.5 s alone and hit vitest's 5 s default when `next build` or a
 * 2-vCPU runner competes for the CPU. Slow tests set their own minute-long timeouts.
 */
export default defineConfig(({ mode }) => {
  const slowEnv = !!process.env.SLOW && process.env.SLOW !== "0" && process.env.SLOW !== "false";
  const all = mode === "all" || slowEnv;
  const slowOnly = mode === "slow" && !all;
  const pattern = slowOnly ? "*.slow.test.ts" : "*.test.ts";
  return {
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    test: {
      environment: "node",
      include: [`src/**/${pattern}`, `scripts/**/${pattern}`],
      exclude: all || slowOnly ? ["**/node_modules/**"] : ["**/node_modules/**", "**/*.slow.test.ts"],
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  };
});
