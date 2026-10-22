"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Thin JSON fetch wrapper that surfaces the API's `{ error, details }` shape. */
export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text.slice(0, 400) };
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload as T;
}

export function postJson<T>(path: string, body?: unknown): Promise<T> {
  return getJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export function patchJson<T>(path: string, body?: unknown): Promise<T> {
  return getJson<T>(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export function deleteJson<T>(path: string): Promise<T> {
  return getJson<T>(path, { method: "DELETE" });
}

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
  refresh: () => void;
}

/**
 * Polling fetch. `intervalMs = 0` means "load once". Errors keep the previous
 * data on screen so a hiccup does not blank the page.
 */
export function usePoll<T>(path: string | null, intervalMs = 0, deps: unknown[] = []): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const depsKey = JSON.stringify(deps);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const payload = await getJson<T>(path);
        if (cancelled) return;
        setData(payload);
        setError(null);
        setUpdatedAt(Date.now());
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    if (!intervalMs) return () => { cancelled = true; };
    const timer = setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, intervalMs, tick, depsKey]);

  return { data, error, loading, updatedAt, refresh };
}

/** Local form state helper with a typed setter. */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  }, []);
  const reset = useCallback(() => setValues(initial), [initial]);
  return { values, set, reset, setValues };
}

export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** Keeps the newest `max` entries without growing the array. */
export function pushCapped<T>(list: T[], entry: T, max = 40): T[] {
  return [entry, ...list].slice(0, max);
}

export function useInterval(callback: () => void, ms: number | null): void {
  const ref = useRef(callback);
  ref.current = callback;
  useEffect(() => {
    if (!ms) return;
    const timer = setInterval(() => ref.current(), ms);
    return () => clearInterval(timer);
  }, [ms]);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function timeAgo(secondsOrMs: number | string | Date | null | undefined): string {
  if (secondsOrMs === null || secondsOrMs === undefined || secondsOrMs === "") return "—";
  let ms: number;
  if (secondsOrMs instanceof Date) {
    ms = secondsOrMs.getTime();
  } else if (typeof secondsOrMs === "string") {
    const parsed = Date.parse(secondsOrMs);
    if (Number.isNaN(parsed)) return "—";
    ms = parsed;
  } else {
    ms = secondsOrMs < 1e12 ? secondsOrMs * 1000 : secondsOrMs;
  }
  const delta = Math.max(0, Date.now() - ms);
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

export function clockOf(value: string | number | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
