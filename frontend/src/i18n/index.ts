/** Interface text by key, with {name} placeholders filled. */
import { ENGLISH, type Key } from "./strings";

export function translate(key: Key, values: Record<string, string> = {}): string {
  return ENGLISH[key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "");
}

export function useT() {
  return translate;
}

export type { Key };
