import { createFileRoute, notFound } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { articleBySlug } from "../../../learn/catalog";
import { ARTICLE_CONTENT, articleContent } from "../../../learn/articles";
import { CourseSidebar } from "../../../components/CourseSidebar";
import { routeHead } from "../../../lib/seo";
import { useCopy, useLocale, useText } from "../../../i18n";

const copy = {
  es: {
    breadcrumb: "Ruta de navegación",
    course: "Curso",
    readings: "Lecturas",
    reading: "Lectura",
    nextTitle: "De la lectura al programa",
    openLab: "Abrir el laboratorio relacionado →",
    discuss: "Discutir esta lectura en el foro →",
    noteA: "Material comunitario para Effect 4 RC. Contrastá la API con la",
    noteLink: "documentación oficial",
    noteB: "de la versión que uses.",
  },
  pt: {
    breadcrumb: "Trilha de navegação",
    course: "Curso",
    readings: "Leituras",
    reading: "Leitura",
    nextTitle: "Da leitura ao programa",
    openLab: "Abrir o laboratório relacionado →",
    discuss: "Discutir esta leitura no fórum →",
    noteA: "Material comunitário para Effect 4 RC. Confira a API na",
    noteLink: "documentação oficial",
    noteB: "da versão que você usa.",
  },
};

export const Route = createFileRoute("/learn/articles/$slug")({
  beforeLoad: ({ params }) => {
    if (!articleBySlug(params.slug)) throw notFound();
  },
  head: ({ params }) => {
    const article = articleBySlug(params.slug);
    return routeHead({
      title: article?.title.es ?? "Artículo",
      description: article && ARTICLE_CONTENT[article.id]?.summary,
      path: `/learn/articles/${encodeURIComponent(params.slug)}`,
    });
  },
  component: ArticlePage,
});

function ArticlePage() {
  const params = Route.useParams();
  const meta = () => articleBySlug(params().slug)!;
  const t = useCopy(copy);
  const text = useText();
  const { locale } = useLocale();
  const article = () => articleContent(meta().id, locale());
  return (
    <main class="workspace" data-testid="article">
      <nav class="breadcrumb" aria-label={t().breadcrumb}>
        <a href="/learn">{t().course}</a>
        <span aria-hidden="true">/</span>
        <span>{t().readings}</span>
      </nav>
      <div class="reading-grid">
        <CourseSidebar />
        <article>
          <header class="lesson-header">
            <p class="eyebrow">
              {t().reading} / {meta().id.slice(1)} · {article().minutes} min
            </p>
            <h1>{text(meta().title)}</h1>
            <p>{article().summary}</p>
          </header>
          <div class="article-prose lesson-section">
            <For each={article().sections}>
              {(section) => (
                <section>
                  <h2>{section.title}</h2>
                  <For each={section.paragraphs}>{(paragraph) => <p>{paragraph}</p>}</For>
                  <Show when={section.code}>
                    {(code) => (
                      <pre>
                        <code>{code()}</code>
                      </pre>
                    )}
                  </Show>
                </section>
              )}
            </For>
          </div>
          <aside class="community-note">
            <h2>{t().nextTitle}</h2>
            <p>
              <a href={`/learn/${article().lab}`}>{t().openLab}</a>
            </p>
            <a href="/foros/articles">{t().discuss}</a>
          </aside>
          <p class="lesson-note">
            {t().noteA} <a href="https://effect.website/docs/">{t().noteLink}</a> {t().noteB}
          </p>
        </article>
      </div>
    </main>
  );
}
