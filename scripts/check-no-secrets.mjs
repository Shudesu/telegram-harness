import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const skip = new Set(["node_modules", ".git", "dist", ".next", ".wrangler", ".local"]);
const tokenLike = /\d{8,10}:[A-Za-z0-9_-]{30,}/;
const liveFlag = /TELEGRAM_ALLOW_NETWORK\s*=\s*["']true["']/;
const findings = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (name === ".env" || name.startsWith(".env.") && name !== ".env.example") {
      findings.push(`${relative(root, path)} is a local env file and must not be committed`);
    }
    if (name === "check-no-secrets.mjs") continue;
    const text = readFileSync(path, "utf8");
    if (tokenLike.test(text)) findings.push(`${relative(root, path)} matches a Bot API token pattern`);
    if (liveFlag.test(text) && !text.includes("refuses TELEGRAM_ALLOW_NETWORK")) {
      findings.push(`${relative(root, path)} enables TELEGRAM_ALLOW_NETWORK`);
    }
  }
}

walk(root);
if (findings.length) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log("no secret-shaped values found");
