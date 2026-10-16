import { en, type MessageKey } from './en';
import { he } from './he';

export type UiLang = 'he' | 'en';

const dictionaries: Record<UiLang, Record<MessageKey, string>> = { en, he };

/** Reactive UI language. Reading `i18n.lang` inside a component re-renders it on change. */
class I18n {
  lang = $state<UiLang>('en');

  get dir(): 'rtl' | 'ltr' {
    return this.lang === 'he' ? 'rtl' : 'ltr';
  }

  set(lang: UiLang) {
    this.lang = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = this.dir;
  }

  /** Resolve the `ui.language` setting ("auto" follows the OS / webview locale). */
  resolve(setting: string, osLocale: string): UiLang {
    if (setting === 'he' || setting === 'en') return setting;
    const locales = [osLocale, ...navigator.languages];
    return locales.some((l) => l?.toLowerCase().startsWith('he') || l?.toLowerCase().startsWith('iw')) ? 'he' : 'en';
  }
}

export const i18n = new I18n();

/** Translate with `{name}` placeholders. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let s = dictionaries[i18n.lang][key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Pick the current language's string from a {he, en} pair. */
export function pick(title: { he: string; en: string }): string {
  return i18n.lang === 'he' ? title.he : title.en;
}
