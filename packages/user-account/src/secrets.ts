const SECRET_NAME = /^[A-Z][A-Z0-9_]{2,64}$/;

export interface SecretStore {
  get(name: string): Promise<string | undefined>;
  put(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export class EnvSecretStore implements SecretStore {
  constructor(private readonly env: Record<string, string | undefined>) {}

  async get(name: string): Promise<string | undefined> {
    assertSecretName(name);
    const value = this.env[name];
    return value && value.length > 0 ? value : undefined;
  }

  async put(name: string, value: string): Promise<void> {
    assertSecretName(name);
    if (value.length < 1 || value.length > 200_000) throw new Error("invalid_secret_value");
    this.env[name] = value;
  }

  async delete(name: string): Promise<void> {
    assertSecretName(name);
    delete this.env[name];
  }
}

export function assertSecretName(name: string): void {
  if (!SECRET_NAME.test(name)) throw new Error("invalid_secret_name");
}

export const SESSION_ENV_NAME = "TELEGRAM_USER_SESSION";
export const LOGIN_SESSION_ENV_NAME = "TELEGRAM_USER_LOGIN_SESSION";
export const LOGIN_PHONE_ENV_NAME = "TELEGRAM_USER_LOGIN_PHONE";
