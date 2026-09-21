import { For, Show, createMemo, createSignal, onSettled } from "solid-js";
import { LATAM_COUNTRIES } from "../lib/countries";
import { LATAM_MAP_PATHS, LATAM_MAP_VIEWBOX } from "../lib/latamMapPaths";
import { LinkButton } from "./ui";
import { useCopy, useText } from "../i18n";

const copy = {
  es: {
    label: "Comunidad LatAm",
    active: "Activos",
    one: "país representado",
    many: "países representados",
    join: "Unirme",
    map: "Mapa de Latinoamérica",
    empty: "Sin países registrados todavía.",
  },
  pt: {
    label: "Comunidade LatAm",
    active: "Ativos",
    one: "país representado",
    many: "países representados",
    join: "Participar",
    map: "Mapa da América Latina",
    empty: "Nenhum país registrado ainda.",
  },
};

async function fetchCodes(): Promise<string[]> {
  const res = await fetch("/api/community/countries");
  if (!res.ok) return ["UY"];
  const data = (await res.json()) as { codes?: string[] };
  return data.codes?.length ? data.codes : ["UY"];
}

export function CommunityAtlas() {
  const t = useCopy(copy);
  const text = useText();
  const [codes, setCodes] = createSignal<string[]>(["UY"]);
  onSettled(() => {
    void fetchCodes().then(setCodes);
  });
  const active = createMemo(() => new Set(codes().map((c) => c.toUpperCase())));
  const activeList = createMemo(() => LATAM_COUNTRIES.filter((c) => active().has(c.code)));
  const marquee = createMemo(() => LATAM_COUNTRIES.filter((c) => !active().has(c.code)));
  const countLabel = () => (activeList().length === 1 ? t().one : t().many);

  return (
    <section class="community-atlas" aria-label={t().label} data-testid="community-atlas">
      <div class="community-atlas__shell">
        <div class="community-atlas__grid" aria-hidden="true" />

        <header class="community-atlas__header">
          <ul class="community-atlas__legend">
            <li>
              <span class="community-atlas__swatch community-atlas__swatch--live" />
              {t().active}
            </li>
            <li>
              <span class="community-atlas__swatch community-atlas__swatch--dim" />
              LatAm
            </li>
          </ul>
          <p class="community-atlas__readout">
            <span class="community-atlas__dot community-atlas__dot--live" aria-hidden="true" />
            {activeList().length} {countLabel()}
          </p>
        </header>

        <div class="community-atlas__strip-row">
          <div class="community-atlas__static" data-testid="atlas-static">
            <For each={activeList()}>
              {(c) => (
                <span
                  class="community-atlas__beacon community-atlas__beacon--live"
                  title={text(c.name)}
                >
                  <img
                    class="community-atlas__flag"
                    src={c.flagSrc}
                    alt={text(c.name)}
                    width="28"
                    height="20"
                  />
                  <span class="community-atlas__iso">{c.code}</span>
                </span>
              )}
            </For>
          </div>
          <div class="community-atlas__viewport" aria-hidden="true">
            <div class="community-atlas__track">
              <div class="community-atlas__marquee">
                <For each={[...marquee(), ...marquee()]}>
                  {(c) => (
                    <span class="community-atlas__beacon community-atlas__beacon--dim">
                      <img
                        class="community-atlas__flag"
                        src={c.flagSrc}
                        alt=""
                        width="28"
                        height="20"
                      />
                      <span class="community-atlas__iso">{c.code}</span>
                    </span>
                  )}
                </For>
              </div>
            </div>
          </div>
          <div class="community-atlas__cta">
            <LinkButton
              href="/api/auth/login?returnTo=/perfil"
              variant="secondary"
              fillStyle="outline"
              UNSAFE_className="el-cta-ghost"
            >
              {t().join}
            </LinkButton>
          </div>
        </div>

        <div class="community-atlas__map-panel">
          <div class="community-atlas__map-glow" aria-hidden="true" />
          <svg
            class="community-atlas__map"
            viewBox={LATAM_MAP_VIEWBOX}
            role="img"
            aria-label={t().map}
          >
            <defs>
              {/*
                Procedural Uruguay flag texture (objectBoundingBox).
                Fill MUST be set as an SVG attribute/style — not external CSS
                url(#id), which resolves against the stylesheet URL and paints nothing.
              */}
              <pattern
                id="atlas-uy-flag"
                patternUnits="objectBoundingBox"
                patternContentUnits="objectBoundingBox"
                width="1"
                height="1"
              >
                {/* 9 stripes: white / celeste starting with white */}
                <rect x="0" y="0" width="1" height="1" fill="#ffffff" />
                <rect x="0" y="0.1111" width="1" height="0.1111" fill="#0038a8" />
                <rect x="0" y="0.3333" width="1" height="0.1111" fill="#0038a8" />
                <rect x="0" y="0.5556" width="1" height="0.1111" fill="#0038a8" />
                <rect x="0" y="0.7778" width="1" height="0.1111" fill="#0038a8" />
                {/* Canton + Sol de Mayo (simplified gold disc) */}
                <rect x="0" y="0" width="0.38" height="0.444" fill="#ffffff" />
                <circle cx="0.19" cy="0.222" r="0.12" fill="#fcd116" />
                <circle cx="0.19" cy="0.222" r="0.055" fill="#ffffff" opacity="0.35" />
              </pattern>
            </defs>
            <For each={Object.entries(LATAM_MAP_PATHS)}>
              {([code, paths]) => {
                const iso = code.toUpperCase();
                const isUy = iso === "UY";
                return (
                  <g
                    class={[
                      "community-atlas__land",
                      active().has(iso) ? "community-atlas__land--live" : "",
                      isUy ? "community-atlas__land--uy" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <For each={[...paths]}>
                      {(d) =>
                        isUy ? (
                          <path
                            d={d}
                            // Inline style so fragment resolves against the document
                            style={{ fill: "url(#atlas-uy-flag)" }}
                          />
                        ) : (
                          <path d={d} />
                        )
                      }
                    </For>
                  </g>
                );
              }}
            </For>
          </svg>
          <div class="community-atlas__map-frame" aria-hidden="true">
            <span class="community-atlas__corner community-atlas__corner--tl" />
            <span class="community-atlas__corner community-atlas__corner--tr" />
            <span class="community-atlas__corner community-atlas__corner--bl" />
            <span class="community-atlas__corner community-atlas__corner--br" />
          </div>
        </div>

        <Show when={activeList().length === 0}>
          <p class="el-muted">{t().empty}</p>
        </Show>
      </div>
    </section>
  );
}
