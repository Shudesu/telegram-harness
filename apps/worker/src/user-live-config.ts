export function userLiveBind(env: { HOST?: string; PORT?: string }): { hostname: string; port: number } {
  const hostname = env.HOST?.trim() ? env.HOST.trim() : "127.0.0.1";
  const rawPort = env.PORT?.trim();
  const port = Number(rawPort ? rawPort : 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid_port");
  return { hostname, port };
}
