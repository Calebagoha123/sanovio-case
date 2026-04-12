import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { config } from "dotenv";
import path from "path";

// Load .env.local before any test modules are resolved
config({ path: path.resolve(process.cwd(), ".env.local") });

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    fileParallelism: false, // DB tests share a local Supabase instance; run serially
    projects: [
      {
        test: {
          name: "ci",
          include: [
            "src/lib/dates/**/*.test.ts",
            "src/lib/units/**/*.test.ts",
          ],
        },
      },
      {
        test: {
          name: "unit",
          include: ["src/lib/**/*.test.ts"],
          exclude: [
            "src/lib/agent/agent-loop.test.ts",
            "src/lib/agent/conversations.e2e.test.ts",
          ],
        },
      },
      {
        test: {
          name: "integration",
          include: ["src/lib/agent/agent-loop.test.ts"],
        },
      },
      {
        test: {
          name: "e2e",
          include: ["src/lib/agent/conversations.e2e.test.ts"],
        },
      },
    ],
  },
});
