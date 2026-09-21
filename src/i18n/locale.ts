/** Languages the site is written in. Spanish is the default. */
export type Locale = "es" | "pt";

export const LOCALES: readonly Locale[] = ["es", "pt"] as const;
export const DEFAULT_LOCALE: Locale = "es";
export const LOCALE_COOKIE = "el_locale";

/** A piece of copy in every site language. */
export type Text = Readonly<Record<Locale, string>>;

/** BCP 47 tag for `<html lang>` and `Intl` formatters. */
export const HTML_LANG: Record<Locale, string> = { es: "es", pt: "pt-BR" };

export function parseLocale(value: string | null | undefined): Locale | undefined {
  const tag = value?.trim().toLowerCase();
  if (!tag) return undefined;
  if (tag === "pt" || tag.startsWith("pt-")) return "pt";
  if (tag === "es" || tag.startsWith("es-")) return "es";
  return undefined;
}

/** First supported language in an Accept-Language header, ignoring q-values' order ties. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | undefined {
  if (!header) return undefined;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag, weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag } of ranked) {
    const locale = parseLocale(tag);
    if (locale) return locale;
  }
  return undefined;
}

export function localeFromCookieHeader(header: string | null | undefined): Locale | undefined {
  if (!header) return undefined;
  for (const pair of header.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === LOCALE_COOKIE) return parseLocale(decodeURIComponent(rest.join("=")));
  }
  return undefined;
}

/** The visitor's saved choice wins; otherwise their browser language; otherwise Spanish. */
export function resolveLocale(
  cookieHeader: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  return (
    localeFromCookieHeader(cookieHeader) ??
    localeFromAcceptLanguage(acceptLanguage) ??
    DEFAULT_LOCALE
  );
}

export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
