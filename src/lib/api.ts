import { NextResponse } from "next/server";
import { ensureDb } from "@/db";

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, init);
}

export function fail(error: unknown, fallbackStatus = 500): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  const status = error instanceof HttpError ? error.status : fallbackStatus;
  const details = error instanceof HttpError ? error.details : undefined;
  console.error("[api]", message);
  return NextResponse.json({ error: message, details }, { status });
}

/**
 * Shared guard: waits for the database bootstrap, runs the handler, and turns
 * thrown errors into JSON responses.
 */
export async function guard<T>(handler: () => Promise<T>): Promise<NextResponse> {
  try {
    await ensureDb();
    const data = await handler();
    if (data instanceof NextResponse) return data;
    return NextResponse.json((data ?? { ok: true }) as object);
  } catch (error) {
    return fail(error);
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${field} is required`);
  return value.trim();
}
