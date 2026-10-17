/** The chosen language: remembered in this browser, first guessed from the browser's own language. */
import { useEffect } from "react";
import { create } from "zustand";

import { ENGLISH, type Key, LANGUAGES, type Lang, STRINGS } from "./strings";

const STORAGE_KEY = "earthpulse.lang";

export function initialLang(stored: string | null, browser: readonly string[]): Lang {
  const known = (code: string | null | undefined): Lang | null =>
    (LANGUAGES.find((l) => code && code.toLowerCase().startsWith(l.id))?.id ?? null);
  return known(stored) ?? browser.map(known).find((l): l is Lang => l !== null) ?? "en";
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export const useLang = create<{ lang: Lang; setLang: (lang: Lang) => void }>((set) => ({
  lang: initialLang(readStored(), typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]),
  setLang: (lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // private mode: the choice lasts for this visit
    }
    set({ lang });
  },
}));

/** Text for a key in a language, with {name} placeholders filled; English when a language lacks the key. */
export function translate(lang: Lang, key: Key, values: Record<string, string> = {}): string {
  const text = STRINGS[lang][key] ?? ENGLISH[key];
  return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "");
}

export function useT() {
  const lang = useLang((s) => s.lang);
  return (key: Key, values?: Record<string, string>) => translate(lang, key, values);
}

/** Keep the page's lang and direction in step with the chosen language, for screen readers and right-to-left text. */
export function useDocumentLanguage() {
  const lang = useLang((s) => s.lang);
  useEffect(() => {
    const info = LANGUAGES.find((l) => l.id === lang)!;
    document.documentElement.lang = lang;
    document.documentElement.dir = info.dir;
  }, [lang]);
}

export { LANGUAGES, type Lang, type Key };
