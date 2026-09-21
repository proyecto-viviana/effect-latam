import type { Locale } from "../i18n/locale";

export interface ForumMeta {
  slug: string;
  title: string;
  description: string;
  pt: { title: string; description: string };
  /** Related learn lesson id when applicable */
  lessonId?: string;
}

export const FORUMS: readonly ForumMeta[] = [
  {
    slug: "general",
    title: "General",
    description: "Presentaciones, proyectos y preguntas que todavía no tienen categoría.",
    pt: {
      title: "Geral",
      description: "Apresentações, projetos e perguntas que ainda não têm categoria.",
    },
  },
  {
    slug: "effect-gen",
    title: "Effect.gen",
    description: "Construir, componer y ejecutar programas. Dudas de la primera lección.",
    pt: {
      title: "Effect.gen",
      description: "Construir, compor e executar programas. Dúvidas da primeira lição.",
    },
    lessonId: "i01",
  },
  {
    slug: "errors",
    title: "Errores como datos",
    description: "Fallos esperados, etiquetas y estrategias de recuperación.",
    pt: {
      title: "Erros como dados",
      description: "Falhas esperadas, etiquetas e estratégias de recuperação.",
    },
    lessonId: "i02",
  },
  {
    slug: "layers",
    title: "Servicios y Layers",
    description: "Contratos, dependencias e implementaciones de prueba.",
    pt: {
      title: "Serviços e Layers",
      description: "Contratos, dependências e implementações de teste.",
    },
    lessonId: "i03",
  },
  {
    slug: "concurrency",
    title: "Concurrencia y retry",
    description: "Fibras, all, race y políticas de reintentos.",
    pt: {
      title: "Concorrência e retry",
      description: "Fibras, all, race e políticas de novas tentativas.",
    },
    lessonId: "i04",
  },
  {
    slug: "schema-scope",
    title: "Datos y recursos",
    description: "Validación en las fronteras y liberación de recursos.",
    pt: {
      title: "Dados e recursos",
      description: "Validação nas fronteiras e liberação de recursos.",
    },
    lessonId: "i06",
  },
  {
    slug: "articles",
    title: "Lecturas",
    description: "Ideas, dudas y ejemplos que nacen de los artículos del curso.",
    pt: {
      title: "Leituras",
      description: "Ideias, dúvidas e exemplos que nascem dos artigos do curso.",
    },
  },
];

const BY_SLUG = new Map(FORUMS.map((f) => [f.slug, f]));

export function getForum(slug: string): ForumMeta | undefined {
  return BY_SLUG.get(slug);
}

/** The forum's title and description in the reader's language. */
export function forumText(
  forum: ForumMeta,
  locale: Locale,
): { title: string; description: string } {
  return locale === "pt" ? forum.pt : forum;
}
