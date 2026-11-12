const STUB = new URL('./cf-stub.mjs', import.meta.url).href;
export function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return {url: STUB, shortCircuit: true};
  return next(specifier, context);
}
