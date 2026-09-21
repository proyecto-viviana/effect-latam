import { createFileRoute, notFound } from "@tanstack/solid-router";
import { For, Show, createSignal, onSettled } from "solid-js";
import { forumText, getForum } from "../../../forums/registry";
import {
  forumRequest,
  publicationError,
  type PageResult,
  type ThreadSummary,
} from "../../../forums/client";
import { Button, Form, TextArea, TextField } from "../../../components/ui";
import { ForumSidebar } from "../../../components/ForumSidebar";
import { SessionGate } from "../../../components/SessionGate";
import { routeHead } from "../../../lib/seo";
import { useCopy, useLocale } from "../../../i18n";

const copy = {
  es: {
    breadcrumb: "Ruta de navegación",
    forums: "Foros",
    retry: "Reintentar",
    previous: "← Anterior",
    next: "Siguiente →",
    page: "Página",
    eyebrow: "Foro de la comunidad",
    threads: "Conversaciones",
    open: "Abrir un tema ↗",
    loading: "Cargando conversaciones…",
    loadFailedTitle: "No pudimos cargar los temas",
    loadFailedBody: "Puede ser un problema de conexión. Volvé a intentarlo.",
    emptyTitle: "La primera pregunta puede ser la tuya",
    emptyBody: "Todavía no hay conversaciones en este espacio.",
    reply: "respuesta",
    replies: "respuestas",
    pages: "Páginas de conversaciones",
    composeTitle: "Abrí una conversación",
    composeBody: "Compartí el contexto, tu pregunta y un ejemplo que podamos probar.",
    fieldTitle: "Título",
    fieldContent: "Contenido",
    fieldHelp: "Texto plano. Máximo 20.000 caracteres.",
    publishing: "Publicando…",
    publish: "Publicar conversación",
  },
  pt: {
    breadcrumb: "Trilha de navegação",
    forums: "Fóruns",
    retry: "Tentar de novo",
    previous: "← Anterior",
    next: "Próxima →",
    page: "Página",
    eyebrow: "Fórum da comunidade",
    threads: "Conversas",
    open: "Abrir um tópico ↗",
    loading: "Carregando conversas…",
    loadFailedTitle: "Não conseguimos carregar os tópicos",
    loadFailedBody: "Pode ser um problema de conexão. Tente de novo.",
    emptyTitle: "A primeira pergunta pode ser a sua",
    emptyBody: "Ainda não há conversas neste espaço.",
    reply: "resposta",
    replies: "respostas",
    pages: "Páginas de conversas",
    composeTitle: "Abra uma conversa",
    composeBody: "Compartilhe o contexto, a sua pergunta e um exemplo que possamos testar.",
    fieldTitle: "Título",
    fieldContent: "Conteúdo",
    fieldHelp: "Texto simples. Máximo de 20.000 caracteres.",
    publishing: "Publicando…",
    publish: "Publicar conversa",
  },
};

export const Route = createFileRoute("/foros/$slug/")({
  beforeLoad: ({ params }) => {
    if (!getForum(params.slug)) throw notFound();
  },
  head: ({ params }) =>
    routeHead({
      title: getForum(params.slug)?.title ?? "Foro",
      description: getForum(params.slug)?.description,
      path: `/foros/${encodeURIComponent(params.slug)}`,
    }),
  component: ForumBoard,
});

function ForumBoard() {
  const params = Route.useParams();
  const t = useCopy(copy);
  const { locale } = useLocale();
  const forum = () => getForum(params().slug)!;
  const forumCopy = () => forumText(forum(), locale());
  const [threads, setThreads] = createSignal<PageResult<ThreadSummary>>();
  const [page, setPage] = createSignal(1);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal(false);
  const [title, setTitle] = createSignal("");
  const [content, setContent] = createSignal("");
  const [err, setErr] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let loadRevision = 0;

  async function loadThreads(target = page()) {
    const current = ++loadRevision;
    setLoading(true);
    setLoadError(false);
    try {
      const result = await forumRequest<PageResult<ThreadSummary>>(
        `/api/forum/threads?forumSlug=${encodeURIComponent(params().slug)}&page=${target}`,
      );
      if (current !== loadRevision) return;
      setThreads(result);
      setPage(target);
    } catch {
      if (current === loadRevision) setLoadError(true);
    } finally {
      if (current === loadRevision) setLoading(false);
    }
  }
  onSettled(() => {
    void loadThreads();
  });

  async function onCreate(event: Event) {
    event.preventDefault();
    if (busy()) return;
    setErr("");
    setBusy(true);
    try {
      const data = await forumRequest<{ id: string }>("/api/forum/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forumSlug: params().slug, title: title(), content: content() }),
      });
      window.location.href = `/foros/${params().slug}/${encodeURIComponent(data.id)}`;
    } catch (error) {
      setErr(publicationError(error, locale()));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="workspace" data-testid="forum-board">
      <nav class="breadcrumb" aria-label={t().breadcrumb}>
        <a href="/foros">{t().forums}</a>
        <span aria-hidden="true">/</span>
        <span>{forumCopy().title}</span>
      </nav>
      <div class="reading-grid">
        <ForumSidebar current={forum().slug} />
        <div>
          <header class="lesson-header">
            <p class="eyebrow">{t().eyebrow}</p>
            <h1>{forumCopy().title}</h1>
            <p>{forumCopy().description}</p>
          </header>
          <section
            class="lesson-section"
            aria-label={t().threads}
            aria-busy={loading() ? "true" : "false"}
          >
            <div class="section-heading">
              <h2>{t().threads}</h2>
              <a class="el-link" href="#nuevo-hilo">
                {t().open}
              </a>
            </div>
            <Show when={loading()}>
              <p role="status">{t().loading}</p>
            </Show>
            <Show when={loadError()}>
              <div class="state-panel">
                <h2>{t().loadFailedTitle}</h2>
                <p role="alert">{t().loadFailedBody}</p>
                <Button
                  fillStyle="outline"
                  onPress={() => {
                    void loadThreads();
                  }}
                >
                  {t().retry}
                </Button>
              </div>
            </Show>
            <Show when={!loading() && !loadError() && threads()}>
              {(result) => (
                <>
                  <Show
                    when={result().items.length}
                    fallback={
                      <div class="state-panel">
                        <h2>{t().emptyTitle}</h2>
                        <p>{t().emptyBody}</p>
                      </div>
                    }
                  >
                    <ul class="discussion-list">
                      <For each={result().items}>
                        {(thread) => (
                          <li>
                            <a href={`/foros/${params().slug}/${encodeURIComponent(thread.id)}`}>
                              <strong>{thread.title}</strong>
                              <small>
                                {thread.replyCount}{" "}
                                {thread.replyCount === 1 ? t().reply : t().replies}
                              </small>
                            </a>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </>
              )}
            </Show>
            <Show when={threads()}>
              <nav class="pagination" aria-label={t().pages}>
                <Button
                  fillStyle="outline"
                  isDisabled={page() === 1 || loading()}
                  onPress={() => {
                    void loadThreads(page() - 1);
                  }}
                >
                  {t().previous}
                </Button>
                <span>
                  {t().page} {page()}
                </span>
                <Button
                  fillStyle="outline"
                  isDisabled={!threads()?.hasMore || loading()}
                  onPress={() => {
                    void loadThreads(page() + 1);
                  }}
                >
                  {t().next}
                </Button>
              </nav>
            </Show>
          </section>
          <section class="composer" id="nuevo-hilo">
            <h2>{t().composeTitle}</h2>
            <p>{t().composeBody}</p>
            <SessionGate returnTo={`/foros/${params().slug}#nuevo-hilo`}>
              <Form onSubmit={onCreate} UNSAFE_className="el-form">
                <TextField
                  label={t().fieldTitle}
                  name="thread-title"
                  value={title()}
                  onChange={setTitle}
                  isRequired
                  maxLength={200}
                  data-testid="thread-title"
                />
                <TextArea
                  label={t().fieldContent}
                  name="thread-content"
                  value={content()}
                  onChange={setContent}
                  isRequired
                  maxLength={20_000}
                  description={t().fieldHelp}
                  data-testid="thread-body"
                />
                <Button
                  type="submit"
                  variant="primary"
                  isDisabled={busy()}
                  data-testid="thread-submit"
                >
                  {busy() ? t().publishing : t().publish}
                </Button>
                <Show when={err()}>
                  <p class="el-form-msg" role="alert">
                    {err()}
                  </p>
                </Show>
              </Form>
            </SessionGate>
          </section>
        </div>
      </div>
    </main>
  );
}
