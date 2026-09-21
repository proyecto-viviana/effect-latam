import { For } from "solid-js";
import { LOCALES, useCopy, useLocale, type Locale } from "../i18n";

const FLAG: Record<Locale, string> = { es: "/flags/uy.svg", pt: "/flags/br.svg" };

const copy = {
  es: { group: "Idioma", names: { es: "Español", pt: "Portugués" } },
  pt: { group: "Idioma", names: { es: "Espanhol", pt: "Português" } },
};

/** Flag pair that switches the site between Spanish and Brazilian Portuguese. */
export function LocaleToggle() {
  const { locale, setLocale } = useLocale();
  const t = useCopy(copy);
  return (
    <div class="locale-toggle" role="group" aria-label={t().group} data-testid="locale-toggle">
      <For each={LOCALES}>
        {(code) => (
          <button
            type="button"
            class="locale-toggle__option"
            aria-pressed={locale() === code ? "true" : "false"}
            aria-label={t().names[code]}
            title={t().names[code]}
            data-testid={`locale-${code}`}
            onClick={() => setLocale(code)}
          >
            <img src={FLAG[code]} alt="" width="22" height="16" />
          </button>
        )}
      </For>
    </div>
  );
}
