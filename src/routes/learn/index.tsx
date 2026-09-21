import { createFileRoute } from "@tanstack/solid-router";
import { For } from "solid-js";
import { ARTICLES, LABS } from "../../learn/catalog";
import { guideForLab } from "../../learn/course";
import { articleContent } from "../../learn/articles";
import { LinkButton } from "../../components/ui";
import { CourseSidebar } from "../../components/CourseSidebar";
import { routeHead } from "../../lib/seo";
import { useCopy, useLocale, useText } from "../../i18n";

const copy = {
  es: {
    eyebrow: "Aprender Effect · en español",
    titleA: "De los tipos",
    titleB: "a programas confiables.",
    lead: "Un concepto, una predicción y un programa que podés ejecutar. Aprendé a componer errores, servicios y concurrencia, paso a paso.",
    start: "Empezar el recorrido",
    seeProgram: "Ver el programa",
    route: "Recorrido",
    routeValue: "7 lecciones · 4 lecturas",
    time: "Dedicación estimada",
    timeValue: "≈ 2 horas, a tu ritmo",
    before: "Antes de empezar",
    beforeValue: "TypeScript, funciones y async/await",
    version: "Versión del curso",
    program: "El programa",
    lab: "laboratorio",
    why: "Entender el porqué",
    readings: "Lecturas complementarias",
    reading: "Lectura",
    readingTime: "min de lectura",
    togetherTitle: "Aprendé en compañía",
    togetherA: "Los labs son públicos y no necesitan instalación. En los",
    togetherLink: "foros del curso",
    togetherB:
      "podés compartir tu predicción, el resultado y lo que todavía no cierra. Una visita registra actividad; no certifica que dominaste el tema.",
  },
  pt: {
    eyebrow: "Aprender Effect · em português",
    titleA: "Dos tipos",
    titleB: "a programas confiáveis.",
    lead: "Um conceito, uma previsão e um programa que você pode executar. Aprenda a compor erros, serviços e concorrência, passo a passo.",
    start: "Começar o percurso",
    seeProgram: "Ver o programa",
    route: "Percurso",
    routeValue: "7 lições · 4 leituras",
    time: "Dedicação estimada",
    timeValue: "≈ 2 horas, no seu ritmo",
    before: "Antes de começar",
    beforeValue: "TypeScript, funções e async/await",
    version: "Versão do curso",
    program: "O programa",
    lab: "laboratório",
    why: "Entender o porquê",
    readings: "Leituras complementares",
    reading: "Leitura",
    readingTime: "min de leitura",
    togetherTitle: "Aprenda em companhia",
    togetherA: "Os labs são públicos e não precisam de instalação. Nos",
    togetherLink: "fóruns do curso",
    togetherB:
      "você pode compartilhar a sua previsão, o resultado e o que ainda não fecha. Uma visita registra atividade; não certifica que você dominou o tema.",
  },
};

export const Route = createFileRoute("/learn/")({
  head: () =>
    routeHead({
      title: "Curso de Effect",
      description:
        "Un recorrido en español: siete lecciones con laboratorios ejecutables, ejercicios y lecturas de Effect 4.",
      path: "/learn",
    }),
  component: LearnIndex,
});

function LearnIndex() {
  const t = useCopy(copy);
  const text = useText();
  const { locale } = useLocale();
  return (
    <main class="workspace" data-testid="learn-index">
      <header class="page-heading">
        <p class="eyebrow">{t().eyebrow}</p>
        <h1>
          {t().titleA}
          <br />
          {t().titleB}
        </h1>
        <p>{t().lead}</p>
        <div class="page-actions">
          <LinkButton href={`/learn/${LABS[0]!.slug}`} variant="primary">
            {t().start} <span aria-hidden="true">↗</span>
          </LinkButton>
          <LinkButton href="#programa" fillStyle="outline">
            {t().seeProgram}
          </LinkButton>
        </div>
      </header>
      <dl class="course-facts">
        <div>
          <dt>{t().route}</dt>
          <dd>{t().routeValue}</dd>
        </div>
        <div>
          <dt>{t().time}</dt>
          <dd>{t().timeValue}</dd>
        </div>
        <div>
          <dt>{t().before}</dt>
          <dd>{t().beforeValue}</dd>
        </div>
        <div>
          <dt>{t().version}</dt>
          <dd>Effect 4 RC</dd>
        </div>
      </dl>
      <div class="reading-grid">
        <CourseSidebar />
        <div>
          <section id="programa" class="course-section" aria-labelledby="programa-title">
            <div class="section-heading">
              <h2 id="programa-title">{t().program}</h2>
              <p>01 — 07</p>
            </div>
            <ol class="course-list">
              <For each={LABS}>
                {(lab, index) => (
                  <li>
                    <a
                      class="course-row"
                      href={`/learn/${lab.slug}`}
                      data-testid={`lab-link-${lab.id}`}
                    >
                      <span class="course-row__number">{String(index() + 1).padStart(2, "0")}</span>
                      <div>
                        <h3>{text(lab.title)}</h3>
                        <p>{text(lab.blurb)}</p>
                        <small>
                          {guideForLab(lab.id, locale()).module} · {guideForLab(lab.id).minutes} min
                          · {t().lab}
                        </small>
                      </div>
                      <span aria-hidden="true">↗</span>
                    </a>
                  </li>
                )}
              </For>
            </ol>
          </section>
          <section class="course-section" aria-labelledby="lecturas-title">
            <div class="section-heading">
              <h2 id="lecturas-title">{t().why}</h2>
              <p>{t().readings}</p>
            </div>
            <div class="article-grid">
              <For each={ARTICLES}>
                {(article) => (
                  <a class="article-card" href={`/learn/articles/${article.slug}`}>
                    <span class="eyebrow">
                      {t().reading} / {article.id.slice(1)}
                    </span>
                    <h3>{text(article.title)}</h3>
                    <p>{articleContent(article.id, locale()).summary}</p>
                    <small>
                      {articleContent(article.id).minutes} {t().readingTime}{" "}
                      <span aria-hidden="true">↗</span>
                    </small>
                  </a>
                )}
              </For>
            </div>
          </section>
          <aside class="community-note">
            <h2>{t().togetherTitle}</h2>
            {t().togetherA} <a href="/foros">{t().togetherLink}</a> {t().togetherB}
          </aside>
        </div>
      </div>
    </main>
  );
}
