import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { validateTokenEnvName } from "@telegram-harness/shared";
import { EnvSecretStore, LOGIN_PHONE_ENV_NAME, LOGIN_SESSION_ENV_NAME, SESSION_ENV_NAME, type SecretStore } from "./secrets.js";

export class FileSecretStore implements SecretStore {
  private readonly memory: EnvSecretStore;
  private readonly values: Record<string, string | undefined>;
  private readonly persisted: Record<string, string> = {};

  constructor(
    private readonly path: string,
    seed: Record<string, string | undefined>,
  ) {
    assertSecretFilePath(path);
    this.values = {};
    for (const [key, value] of Object.entries(seed)) {
      if (typeof value === "string" && value.length > 0) this.values[key] = value;
    }
    for (const [key, value] of Object.entries(readManaged(path))) {
      this.values[key] = value;
      this.persisted[key] = value;
    }
    this.memory = new EnvSecretStore(this.values);
  }

  get(name: string): Promise<string | undefined> {
    return this.memory.get(name);
  }

  async put(name: string, value: string): Promise<void> {
    await this.memory.put(name, value);
    if (!isManagedSecretKey(name)) return;
    this.persisted[name] = value;
    this.write();
  }

  async delete(name: string): Promise<void> {
    await this.memory.delete(name);
    if (!isManagedSecretKey(name)) return;
    delete this.persisted[name];
    this.write();
  }

  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.persisted), { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}

function readManaged(path: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const stored: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && isManagedSecretKey(key)) stored[key] = value;
    }
    return stored;
  } catch {
    return {};
  }
}

function isManagedSecretKey(name: string): boolean {
  if (name === SESSION_ENV_NAME || name === LOGIN_SESSION_ENV_NAME || name === LOGIN_PHONE_ENV_NAME) return true;
  return validateTokenEnvName(name) === null;
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
