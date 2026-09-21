import {
  createAchievementsRegistry,
  type AchievementDefinition,
  type AchievementsRegistry,
} from "../vendor/social/achievements/registry";

export const EL_ACHIEVEMENTS: AchievementDefinition[] = [
  {
    id: "learn.first_lab",
    category: "custom",
    title: "Primer lab",
    description: "Abriste tu primer laboratorio Effect.",
    metric: "learn.labs.visited",
    threshold: 1,
    source: {
      metric: "learn.labs.visited",
      event: "learn.lab.visited",
      agg: "distinct",
      field: "lessonId",
    },
  },
  {
    id: "learn.three_labs",
    category: "custom",
    title: "Tres labs",
    description: "Visitaste al menos tres laboratorios.",
    metric: "learn.labs.visited",
    threshold: 3,
    source: {
      metric: "learn.labs.visited",
      event: "learn.lab.visited",
      agg: "distinct",
      field: "lessonId",
    },
  },
  {
    id: "learn.all_labs",
    category: "custom",
    title: "Track completo",
    description: "Visitaste los siete labs I01–I07.",
    metric: "learn.labs.visited",
    threshold: 7,
    source: {
      metric: "learn.labs.visited",
      event: "learn.lab.visited",
      agg: "distinct",
      field: "lessonId",
    },
  },
  {
    id: "account.country",
    category: "account",
    title: "En el mapa",
    description: "Elegiste tu país en la comunidad LatAm.",
    metric: "account.country.set",
    threshold: 1,
    source: {
      metric: "account.country.set",
      event: "account.country.set",
      agg: "count",
    },
  },
  {
    id: "account.username",
    category: "account",
    title: "Nombre en la red",
    description: "Elegiste un username público.",
    metric: "account.username.set",
    threshold: 1,
    source: {
      metric: "account.username.set",
      event: "account.username.set",
      agg: "count",
    },
  },
  {
    id: "forum.first_thread",
    category: "forum",
    title: "Primera pregunta",
    description: "Abriste un hilo en los foros.",
    metric: "forum.threads",
    threshold: 1,
    source: [
      { metric: "forum.threads", event: "forum.thread.created", agg: "count" },
      {
        metric: "forum.threads",
        event: "forum.thread.deleted",
        agg: "count",
        delta: -1,
      },
    ],
  },
  {
    id: "forum.first_post",
    category: "forum",
    title: "Primera respuesta",
    description: "Respondiste en un hilo.",
    metric: "forum.posts",
    threshold: 1,
    source: [
      { metric: "forum.posts", event: "forum.post.created", agg: "count" },
      {
        metric: "forum.posts",
        event: "forum.post.deleted",
        agg: "count",
        delta: -1,
      },
    ],
  },
];

export function buildElRegistry(): AchievementsRegistry {
  return createAchievementsRegistry(EL_ACHIEVEMENTS);
}
