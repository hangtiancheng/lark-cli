export const DANGEROUSLY_JSON = "dangerouslyJson";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(value.entries());
  }
  return {};
}

export function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  // // For exception
  // if (value instanceof Error) {
  //   return value.message
  // }

  return String(value);
}

export function asErrorString(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return asString(value);
}

export function isObject(value: unknown) {
  return typeof value === "object" && value !== null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toTry<T extends (...args: any) => any>(fn: T, ctx?: ThisParameterType<T>) {
  if (typeof fn !== "function") {
    return fn;
  }
  return function (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> | undefined {
    let ret: ReturnType<T>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      ret = ctx ? fn.call(ctx, ...args) : fn.call(this, ...args);
    } catch (e) {
      console.error(e);
      return undefined;
    }
    return ret;
  };
}

export const safeJSONParse = toTry(JSON.parse, JSON);

export function asError(err: unknown) {
  if (err instanceof Error) {
    return err;
  }
  return new Error(String(err));
}

export function intArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  if (typeof v === "number") {
    return Math.floor(v);
  }

  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? fallback : n;
  }

  return fallback;
}

export function strArg(args: Record<string, unknown>, key: string, fallback?: string): string {
  const v = args[key];
  if (typeof v === "string") {
    return v;
  }

  return fallback ?? String(v);
}

export function boolArg(args: Record<string, unknown>, key: string, fallback?: boolean): boolean {
  const v = args[key];
  if (typeof v === "boolean") {
    return v;
  }

  return fallback ?? Boolean(v);
}
