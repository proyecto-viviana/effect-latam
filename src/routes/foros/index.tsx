import { createFileRoute } from "@tanstack/solid-router";
import { For } from "solid-js";
import { FORUMS, forumText } from "../../forums/registry";
import { ForumSidebar } from "../../components/ForumSidebar";
import { routeHead } from "../../lib/seo";
import { useCopy, useLocale } from "../../i18n";

const copy = {
  es: {
    eyebrow: "Comunidad · conversación abierta",
    titleA: "Aprender también",
    titleB: "es preguntar.",
    lead: "Un lugar para compartir lo que estás construyendo, destrabar una duda y pensar Effect en compañía.",
    find: "Encontrá tu conversación",
    spaces: "7 espacios · lectura pública",
    askTitle: "Una buena pregunta ayuda a todos",
    askBody:
      "Contá qué intentaste, qué esperabas y qué ocurrió. Incluí un ejemplo mínimo y la versión de Effect. Compartí código sin credenciales ni datos personales y tratá a los demás con respeto.",
  },
  pt: {
    eyebrow: "Comunidade · conversa aberta",
    titleA: "Aprender também",
    titleB: "é perguntar.",
    lead: "Um lugar para compartilhar o que você está construindo, destravar uma dúvida e pensar Effect em companhia.",
    find: "Encontre a sua conversa",
    spaces: "7 espaços · leitura pública",
    askTitle: "Uma boa pergunta ajuda todo mundo",
    askBody:
      "Conte o que você tentou, o que esperava e o que aconteceu. Inclua um exemplo mínimo e a versão do Effect. Compartilhe código sem credenciais nem dados pessoais e trate os outros com respeito.",
  },
};

export const Route = createFileRoute("/foros/")({
  head: () =>
    routeHead({
      title: "Foros",
      description: "Preguntas, ideas y conversaciones de la comunidad Effect Latam.",
      path: "/foros",
    }),
  component: ForosIndex,
});

function ForosIndex() {
  const t = useCopy(copy);
  const { locale } = useLocale();
  return (
    <main class="workspace" data-testid="foros-index">
      <header class="page-heading">
        <p class="eyebrow">{t().eyebrow}</p>
        <h1>
          {t().titleA}
          <br />
          {t().titleB}
        </h1>
        <p>{t().lead}</p>
      </header>
      <div class="reading-grid">
        <ForumSidebar />
        <div>
          <div class="section-heading">
            <h2>{t().find}</h2>
            <p>{t().spaces}</p>
          </div>
          <ul class="topic-list">
            <For each={FORUMS}>
              {(forum) => (
                <li>
                  <a
                    class="topic-row"
                    href={`/foros/${forum.slug}`}
                    data-testid={`forum-${forum.slug}`}
                  >
                    <div>
                      <h2>{forumText(forum, locale()).title}</h2>
                      <p>{forumText(forum, locale()).description}</p>
                    </div>
                    <span aria-hidden="true">↗</span>
                  </a>
                </li>
              )}
            </For>
          </ul>
          <aside class="community-note">
            <h2>{t().askTitle}</h2>
            {t().askBody}
          </aside>
        </div>
      </div>
    </main>
  );
}
