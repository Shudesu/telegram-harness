// Lets Node import the Worker modules unchanged by standing in for the `cloudflare:workers`
// built-in. Only the base class the Durable Object extends is needed.
export class DurableObject {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
}
export class WorkerEntrypoint {}
