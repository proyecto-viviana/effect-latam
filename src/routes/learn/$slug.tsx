import { createFileRoute, notFound } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { LessonChrome } from "../../components/LessonChrome";
import { LabPlayground } from "../../components/LabPlayground";
import { CourseSidebar } from "../../components/CourseSidebar";
import { LABS, labBySlug } from "../../learn/catalog";
import { guideForLab } from "../../learn/course";
import { routeHead } from "../../lib/seo";
import { useCopy, useLocale, useText } from "../../i18n";

const copy = {
  es: {
    breadcrumb: "Ruta de navegación",
    course: "Curso",
    lesson: "Lección",
    learnTitle: "Qué vas a aprender",
    tryTitle: "Probalo en el laboratorio",
    tryA: "Elegí un caso.",
    tryB: "muestra su plan didáctico sin ejecutarlo.",
    tryC: "ejecuta el programa con Effect y devuelve su resultado.",
    yourTurn: "Tu turno",
    checkTitle: "Comprobá tu razonamiento",
    seeAnswer: "Ver explicación",
    talkTitle: "La conversación sigue",
    talkBody: "Compartí qué esperabas, qué pasó y el preset que usaste.",
    talkLink: "Conversar sobre esta lección",
    continue: "Continuar el curso",
    previous: "← Anterior",
    next: "Siguiente →",
    program: "El programa",
    readings: "Profundizar con las lecturas",
  },
  pt: {
    breadcrumb: "Trilha de navegação",
    course: "Curso",
    lesson: "Lição",
    learnTitle: "O que você vai aprender",
    tryTitle: "Teste no laboratório",
    tryA: "Escolha um caso.",
    tryB: "mostra o plano didático sem executá-lo.",
    tryC: "executa o programa com Effect e devolve o resultado.",
    yourTurn: "Sua vez",
    checkTitle: "Confira o seu raciocínio",
    seeAnswer: "Ver explicação",
    talkTitle: "A conversa continua",
    talkBody: "Compartilhe o que você esperava, o que aconteceu e o preset que usou.",
    talkLink: "Conversar sobre esta lição",
    continue: "Continuar o curso",
    previous: "← Anterior",
    next: "Próxima →",
    program: "O programa",
    readings: "Aprofundar com as leituras",
  },
};

export const Route = createFileRoute("/learn/$slug")({
  beforeLoad: ({ params }) => {
    if (!labBySlug(params.slug)) throw notFound();
  },
  head: ({ params }) =>
    routeHead({
      title: labBySlug(params.slug)?.title.es ?? "Lección",
      description: labBySlug(params.slug)?.blurb.es,
      path: `/learn/${encodeURIComponent(params.slug)}`,
    }),
  component: LabPage,
});

function LabPage() {
  const params = Route.useParams();
  const lab = () => labBySlug(params().slug)!;
  const t = useCopy(copy);
  const text = useText();
  const { locale } = useLocale();
  const guide = () => guideForLab(lab().id, locale());
  const index = () => LABS.findIndex((item) => item.id === lab().id);
  const previous = () => LABS[index() - 1];
  const next = () => LABS[index() + 1];
  return (
    <main class="workspace">
      <nav class="breadcrumb" aria-label={t().breadcrumb}>
        <a href="/learn">{t().course}</a>
        <span aria-hidden="true">/</span>
        <span>{text(lab().title)}</span>
      </nav>
      <div class="reading-grid">
        <CourseSidebar current={lab().id} />
        <div>
          <LessonChrome
            title={text(lab().title)}
            blurb={guide().introduction}
            label={`${t().lesson} ${String(index() + 1).padStart(2, "0")} / 07 · ${guide().module} · ${guide().minutes} min`}
          >
            <section class="lesson-section">
              <h2>{t().learnTitle}</h2>
              <ul>
                <For each={guide().objectives}>{(item) => <li>{item}</li>}</For>
              </ul>
            </section>
            <section class="lesson-section">
              <h2>{t().tryTitle}</h2>
              <p>
                {t().tryA} <strong>Describe</strong> {t().tryB} <strong>Run</strong> {t().tryC}
              </p>
              <LabPlayground lab={lab()} />
            </section>
            <section class="lesson-section">
              <h2>{t().yourTurn}</h2>
              <ol>
                <For each={guide().exercise}>{(step) => <li>{step}</li>}</For>
              </ol>
            </section>
            <section class="lesson-section">
              <h2>{t().checkTitle}</h2>
              <p>{guide().question}</p>
              <details class="community-note">
                <summary>{t().seeAnswer}</summary>
                <p>{guide().answer}</p>
              </details>
            </section>
            <aside class="community-note">
              <h2>{t().talkTitle}</h2>
              <p>{t().talkBody}</p>
              <a href={`/foros/${guide().forum}`}>
                {t().talkLink} <span aria-hidden="true">↗</span>
              </a>
            </aside>
            <nav class="lesson-pagination" aria-label={t().continue}>
              <a href={previous() ? `/learn/${previous()!.slug}` : "/learn"}>
                <span>{t().previous}</span>
                {previous() ? text(previous()!.title) : t().program}
              </a>
              <Show
                when={next()}
                fallback={
                  <a href="/learn#lecturas-title">
                    <span>{t().next}</span>
                    {t().readings}
                  </a>
                }
              >
                {(item) => (
                  <a href={`/learn/${item().slug}`}>
                    <span>{t().next}</span>
                    {text(item().title)}
                  </a>
                )}
              </Show>
            </nav>
          </LessonChrome>
        </div>
      </div>
    </main>
  );
}
