import { createIsomorphicFn } from "@tanstack/solid-start";
import { getRequestHeader } from "@tanstack/solid-start/server";
import { createContext, createSignal, useContext } from "solid-js";
import type { Accessor } from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  DEFAULT_LOCALE,
  HTML_LANG,
  localeCookie,
  parseLocale,
  resolveLocale,
  type Locale,
  type Text,
} from "./locale";

export { HTML_LANG, LOCALES, type Locale, type Text } from "./locale";

/**
 * The server decides from the request; the browser then trusts the `lang` the
 * server rendered, so both sides always start on the same language.
 */
const initialLocale = createIsomorphicFn()
  .server(() => resolveLocale(getRequestHeader("cookie"), getRequestHeader("accept-language")))
  .client(() => parseLocale(document.documentElement.lang) ?? DEFAULT_LOCALE);

type LocaleState = {
  locale: Accessor<Locale>;
  setLocale: (next: Locale) => void;
};

const LocaleContext = createContext<LocaleState>();

export function LocaleProvider(props: { children: JSX.Element }) {
  const [locale, setLocaleSignal] = createSignal<Locale>(initialLocale());
  const setLocale = (next: Locale) => {
    document.cookie = localeCookie(next);
    document.documentElement.lang = HTML_LANG[next];
    setLocaleSignal(next);
  };
  return <LocaleContext value={{ locale, setLocale }}>{props.children}</LocaleContext>;
}

export function useLocale(): LocaleState {
  return useContext(LocaleContext);
}

/** Reactive accessor for one component's copy: `const t = useCopy(copy); t().title`. */
export function useCopy<T>(copy: Record<Locale, T>): Accessor<T> {
  const { locale } = useLocale();
  return () => copy[locale()];
}

/** Reactive picker for data that carries its own translations. */
export function useText(): (text: Text) => string {
  const { locale } = useLocale();
  return (text) => text[locale()];
}
