import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { EnvSecretStore, type SecretStore } from "./secrets.js";

export class FileSecretStore implements SecretStore {
  private readonly memory: EnvSecretStore;
  private readonly values: Record<string, string | undefined>;

  constructor(
    private readonly path: string,
    seed: Record<string, string | undefined>,
  ) {
    assertSecretFilePath(path);
    this.values = {};
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") this.values[key] = value;
      }
    } catch {
      // A missing file is an empty store. Permission errors surface on put.
    }
    for (const [key, value] of Object.entries(seed)) {
      if (value && !this.values[key]) this.values[key] = value;
    }
    this.memory = new EnvSecretStore(this.values);
  }

  get(name: string): Promise<string | undefined> {
    return this.memory.get(name);
  }

  async put(name: string, value: string): Promise<void> {
    await this.memory.put(name, value);
    this.write();
  }

  async delete(name: string): Promise<void> {
    await this.memory.delete(name);
    this.write();
  }

  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.values), { mode: 0o600 });
  }
}

export function assertSecretFilePath(path: string): void {
  const resolved = resolve(path);
  const cwd = resolve(process.cwd());
  const localDir = resolve(cwd, ".local");
  const insideCwd = resolved === cwd || resolved.startsWith(cwd + sep);
  const insideLocal = resolved.startsWith(localDir + sep);
  if (insideCwd && !insideLocal) throw new Error("secret_path_rejected");
  if (resolved.includes(`${sep}.git${sep}`)) throw new Error("secret_path_rejected");
}
