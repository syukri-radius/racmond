/**
 * Environment helpers.
 *
 * Several template env vars are frequently present but empty (`DOCKER_SOCKET=""`).
 * `??` treats those as set, so every read goes through envOr(), which treats a
 * blank / whitespace-only value exactly like an unset one.
 */

export function isBlank(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim() === "";
}

export function envOr(key: string, fallback: string): string {
  const raw = process.env[key];
  return isBlank(raw) ? fallback : (raw as string).trim();
}

export function envOrNull(key: string): string | null {
  const raw = process.env[key];
  return isBlank(raw) ? null : (raw as string).trim();
}

/** first non-blank value of the listed keys */
export function envFirst(keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = envOrNull(key);
    if (value) return value;
  }
  return fallback;
}

export function isLoopback(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|host\.docker\.internal)$/i.test(host);
}
