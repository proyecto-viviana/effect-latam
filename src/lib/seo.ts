const SITE_ORIGIN = "https://effectlatam.com";
const DEFAULT_DESCRIPTION =
  "Learn Effect for LatAm TypeScript engineers. Unofficial community host.";

export function routeHead(options: {
  title?: string;
  description?: string;
  path?: string;
  noIndex?: boolean;
}) {
  const title = options.title ? `${options.title} · Effect Latam` : "Effect Latam";
  const description = options.description ?? DEFAULT_DESCRIPTION;
  const path = options.path === "/" ? "" : (options.path ?? "");
  const url = `${SITE_ORIGIN}${path}`;

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      ...(options.noIndex ? [{ name: "robots", content: "noindex, nofollow" }] : []),
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
