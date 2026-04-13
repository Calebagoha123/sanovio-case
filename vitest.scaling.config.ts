import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(process.cwd(), ".env.local") });

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    fileParallelism: false,
    include: ["src/benchmarks/**/*.test.ts"],
  },
});
