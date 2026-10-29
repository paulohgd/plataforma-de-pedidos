import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(file, overwrite = false) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const index = text.indexOf("=");
    if (index < 1) continue;
    const key = text.slice(0, index).trim();
    let value = text.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (overwrite || process.env[key] == null) process.env[key] = value;
  }
}

loadEnv(".env.local");
loadEnv(".env.server", true);
