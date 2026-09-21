import type { Locale } from "../i18n/locale";

type AchievementText = { title: string; description: string };

/** Portuguese text for the achievements in catalog.ts, keyed by id. */
const PT: Record<string, AchievementText> = {
  "learn.first_lab": {
    title: "Primeiro lab",
    description: "Você abriu o seu primeiro laboratório Effect.",
  },
  "learn.three_labs": {
    title: "Três labs",
    description: "Você visitou pelo menos três laboratórios.",
  },
  "learn.all_labs": {
    title: "Trilha completa",
    description: "Você visitou os sete labs I01–I07.",
  },
  "account.country": {
    title: "No mapa",
    description: "Você escolheu o seu país na comunidade LatAm.",
  },
  "account.username": {
    title: "Nome na rede",
    description: "Você escolheu um username público.",
  },
  "forum.first_thread": {
    title: "Primeira pergunta",
    description: "Você abriu um tópico nos fóruns.",
  },
  "forum.first_post": {
    title: "Primeira resposta",
    description: "Você respondeu em um tópico.",
  },
};

/** The API sends Spanish text; this swaps in Portuguese when there is one. */
export function achievementText(
  achievement: AchievementText & { id: string },
  locale: Locale,
): AchievementText {
  return (locale === "pt" && PT[achievement.id]) || achievement;
}
