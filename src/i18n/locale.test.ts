import { describe, expect, it } from "vite-plus/test";
import { localeFromAcceptLanguage, parseLocale, resolveLocale } from "./locale";

describe("locale resolution", () => {
  it("maps regional tags to a site language", () => {
    expect(parseLocale("pt-BR")).toBe("pt");
    expect(parseLocale("es-UY")).toBe("es");
    expect(parseLocale("en-US")).toBeUndefined();
  });

  it("honours q-values in Accept-Language", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9,pt-BR;q=0.8,es;q=0.7")).toBe("pt");
    expect(localeFromAcceptLanguage("en;q=0.9,es;q=0.95,pt;q=0.1")).toBe("es");
    expect(localeFromAcceptLanguage("en-US,fr")).toBeUndefined();
  });

  it("prefers the saved choice over the browser language", () => {
    expect(resolveLocale("a=1; el_locale=es", "pt-BR")).toBe("es");
    expect(resolveLocale("a=1", "pt-BR")).toBe("pt");
    expect(resolveLocale(null, null)).toBe("es");
    expect(resolveLocale("el_locale=klingon", "en")).toBe("es");
  });
});
