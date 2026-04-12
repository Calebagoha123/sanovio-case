import { config } from "dotenv";
import path from "path";

// Load .env.local for test runs
config({ path: path.resolve(process.cwd(), ".env.local") });
