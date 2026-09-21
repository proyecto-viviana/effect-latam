export type LabMeta = {
  id: string;
  slug: string;
  title: { es: string; pt: string; en: string };
  blurb: { es: string; pt: string; en: string };
};

export const LABS: readonly LabMeta[] = [
  {
    id: "i01",
    slug: "effect-gen-playground",
    title: { es: "Effect.gen", pt: "Effect.gen", en: "Effect.gen" },
    blurb: {
      es: "Describe vs run — el programa no se ejecuta al construirse.",
      pt: "Describe vs run — o programa não é executado ao ser construído.",
      en: "Describe vs run — building a program does not execute it.",
    },
  },
  {
    id: "i02",
    slug: "error-channel",
    title: { es: "Canal de error", pt: "Canal de erro", en: "Error channel" },
    blurb: {
      es: "TaggedError, short-circuit y catchTag.",
      pt: "TaggedError, short-circuit e catchTag.",
      en: "TaggedError, short-circuit, and catchTag.",
    },
  },
  {
    id: "i03",
    slug: "layer-graph",
    title: { es: "Layers", pt: "Layers", en: "Layers" },
    blurb: {
      es: "Context.Service, Layer.succeed y provide.",
      pt: "Context.Service, Layer.succeed e provide.",
      en: "Context.Service, Layer.succeed, and provide.",
    },
  },
  {
    id: "i04",
    slug: "fiber-race-all",
    title: { es: "all / race", pt: "all / race", en: "all / race" },
    blurb: {
      es: "Concurrencia estructurada con Effect.all y Effect.race.",
      pt: "Concorrência estruturada com Effect.all e Effect.race.",
      en: "Structured concurrency with Effect.all and Effect.race.",
    },
  },
  {
    id: "i05",
    slug: "schedule-lab",
    title: { es: "Schedule", pt: "Schedule", en: "Schedule" },
    blurb: {
      es: "Effect.retry y Schedule.recurs.",
      pt: "Effect.retry e Schedule.recurs.",
      en: "Effect.retry and Schedule.recurs.",
    },
  },
  {
    id: "i06",
    slug: "schema-decode",
    title: { es: "Schema", pt: "Schema", en: "Schema" },
    blurb: {
      es: "Schema.Struct decode/encode.",
      pt: "Schema.Struct decode/encode.",
      en: "Schema.Struct decode/encode.",
    },
  },
  {
    id: "i07",
    slug: "scope-finalizers",
    title: { es: "Scope", pt: "Scope", en: "Scope" },
    blurb: {
      es: "Effect.scoped y acquireRelease.",
      pt: "Effect.scoped e acquireRelease.",
      en: "Effect.scoped and acquireRelease.",
    },
  },
];

export type ArticleMeta = {
  id: string;
  slug: string;
  title: { es: string; pt: string; en: string };
  file: string;
};

export const ARTICLES: readonly ArticleMeta[] = [
  {
    id: "a01",
    slug: "why-effect-gen",
    title: { es: "¿Por qué Effect.gen?", pt: "Por que Effect.gen?", en: "Why Effect.gen?" },
    file: "A01-why-effect-gen.md",
  },
  {
    id: "a02",
    slug: "errors-as-data",
    title: { es: "Errores como datos", pt: "Erros como dados", en: "Errors as data" },
    file: "A02-errors-as-data.md",
  },
  {
    id: "a03",
    slug: "requirements-and-layers",
    title: { es: "Requisitos y Layers", pt: "Requisitos e Layers", en: "Requirements and Layers" },
    file: "A03-requirements-and-layers.md",
  },
  {
    id: "a04",
    slug: "structured-concurrency-intuition",
    title: {
      es: "Intuición de concurrencia estructurada",
      pt: "Intuição de concorrência estruturada",
      en: "Structured concurrency intuition",
    },
    file: "A04-structured-concurrency.md",
  },
];

export function labBySlug(slug: string): LabMeta | undefined {
  return LABS.find((l) => l.slug === slug);
}

export function articleBySlug(slug: string): ArticleMeta | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}
