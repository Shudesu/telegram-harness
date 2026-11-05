/** Only for a single trusted operator on a loopback-bound server. */
export function isLocalUiRequest(
  enabled: string | undefined,
  host: string | null,
): boolean {
  return (
    enabled === "true" &&
    host !== null &&
    /^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/.test(
      host.toLowerCase(),
    )
  );
}
