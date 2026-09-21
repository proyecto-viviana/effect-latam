/**
 * LATAM + Caribbean catalog for the flag carousel.
 * Community-registered codes (seed UY + countries chosen at signup/config)
 * live in the community country store and sit static on the left rail;
 * the rest marquee in grayscale.
 *
 * Flags are self-hosted SVGs under /public/flags/{iso}.svg — emoji regional
 * indicators are unreliable under many mono stacks and on Linux hosts.
 */

export type LatamCountry = {
  code: string;
  name: { es: string; pt: string; en: string };
  /** Regional indicator emoji (fallback / selects only) */
  flag: string;
  /** Local SVG path for the carousel / UI */
  flagSrc: string;
};

/** ISO → regional indicator pair (select labels, a11y fallback) */
function flagEmoji(code: string): string {
  const cc = code.toUpperCase();
  if (cc.length !== 2) return "🏳️";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 - 65 + c.charCodeAt(0)));
}

export function flagSrcFor(code: string): string {
  return `/flags/${code.toLowerCase()}.svg`;
}

const RAW: { code: string; es: string; pt?: string; en: string }[] = [
  { code: "AR", es: "Argentina", en: "Argentina" },
  { code: "BO", es: "Bolivia", pt: "Bolívia", en: "Bolivia" },
  { code: "BR", es: "Brasil", en: "Brazil" },
  { code: "CL", es: "Chile", en: "Chile" },
  { code: "CO", es: "Colombia", pt: "Colômbia", en: "Colombia" },
  { code: "CR", es: "Costa Rica", en: "Costa Rica" },
  { code: "CU", es: "Cuba", en: "Cuba" },
  { code: "DO", es: "República Dominicana", en: "Dominican Republic" },
  { code: "EC", es: "Ecuador", pt: "Equador", en: "Ecuador" },
  { code: "SV", es: "El Salvador", en: "El Salvador" },
  { code: "GT", es: "Guatemala", en: "Guatemala" },
  { code: "HN", es: "Honduras", en: "Honduras" },
  { code: "MX", es: "México", en: "Mexico" },
  { code: "NI", es: "Nicaragua", pt: "Nicarágua", en: "Nicaragua" },
  { code: "PA", es: "Panamá", en: "Panama" },
  { code: "PY", es: "Paraguay", pt: "Paraguai", en: "Paraguay" },
  { code: "PE", es: "Perú", pt: "Peru", en: "Peru" },
  { code: "PR", es: "Puerto Rico", pt: "Porto Rico", en: "Puerto Rico" },
  { code: "UY", es: "Uruguay", pt: "Uruguai", en: "Uruguay" },
  { code: "VE", es: "Venezuela", en: "Venezuela" },
];

export const LATAM_COUNTRIES: readonly LatamCountry[] = RAW.map((c) => ({
  code: c.code,
  name: { es: c.es, pt: c.pt ?? c.es, en: c.en },
  flag: flagEmoji(c.code),
  flagSrc: flagSrcFor(c.code),
}));

/** Always active in the carousel (seed community). */
export const SEED_ACTIVE_CODES = new Set(["UY"]);

export function isCountryCode(code: string): boolean {
  return LATAM_COUNTRIES.some((c) => c.code === code);
}

export function countryByCode(code: string): LatamCountry | undefined {
  return LATAM_COUNTRIES.find((c) => c.code === code);
}
