import { createFileRoute, notFound } from "@tanstack/solid-router";
import { For, Show, createSignal, onSettled } from "solid-js";
import { Button, Form, TextArea } from "../../../components/ui";
import { ForumSidebar } from "../../../components/ForumSidebar";
import { SessionGate } from "../../../components/SessionGate";
import { forumText, getForum } from "../../../forums/registry";
import {
  ForumRequestError,
  authorName,
  forumRequest,
  publicationError,
  type ThreadDetail,
} from "../../../forums/client";
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
    loading: "Cargando conversación…",
    missingTitle: "Conversación no disponible",
    failedTitle: "No pudimos cargar la conversación",
    missingBody: "Puede haber sido eliminada o no estar disponible para tu cuenta.",
    failedBody: "Tu conexión puede haber fallado. Podés volver a intentarlo.",
    eyebrow: "Conversación",
    opened: "· abrió el tema",
    replies: "Respuestas",
    inThread: "en la conversación",
    empty: "Todavía no hay respuestas. Compartí una idea o una pregunta.",
    pages: "Páginas de respuestas",
    composeTitle: "Seguí la conversación",
    fieldReply: "Tu respuesta",
    sending: "Enviando…",
    publish: "Publicar respuesta",
  },
  pt: {
    breadcrumb: "Trilha de navegação",
    forums: "Fóruns",
    retry: "Tentar de novo",
    previous: "← Anterior",
    next: "Próxima →",
    page: "Página",
    loading: "Carregando conversa…",
    missingTitle: "Conversa não disponível",
    failedTitle: "Não conseguimos carregar a conversa",
    missingBody: "Ela pode ter sido removida ou não estar disponível para a sua conta.",
    failedBody: "Sua conexão pode ter falhado. Você pode tentar de novo.",
    eyebrow: "Conversa",
    opened: "· abriu o tópico",
    replies: "Respostas",
    inThread: "na conversa",
    empty: "Ainda não há respostas. Compartilhe uma ideia ou uma pergunta.",
    pages: "Páginas de respostas",
    composeTitle: "Continue a conversa",
    fieldReply: "Sua resposta",
    sending: "Enviando…",
    publish: "Publicar resposta",
  },
};

export const Route = createFileRoute("/foros/$slug/$threadId")({
  beforeLoad: ({ params }) => {
    if (!getForum(params.slug)) throw notFound();
  },
  head: ({ params }) =>
    routeHead({
      title: "Conversación del foro",
      path: `/foros/${encodeURIComponent(params.slug)}/${encodeURIComponent(params.threadId)}`,
    }),
  component: ThreadPage,
});

function ThreadPage() {
  const params = Route.useParams();
  const t = useCopy(copy);
  const { locale } = useLocale();
  const [data, setData] = createSignal<ThreadDetail>();
  const [page, setPage] = createSignal(1);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<"missing" | "failed">();
  const [reply, setReply] = createSignal("");
  const [err, setErr] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let revision = 0;

  async function loadThread(target = page()) {
    const current = ++revision;
    setLoading(true);
    setLoadError(undefined);
    try {
      const result = await forumRequest<ThreadDetail>(
        `/api/forum/threads/${encodeURIComponent(params().threadId)}?page=${target}`,
      );
      if (current !== revision) return;
      if (result.thread.forumSlug !== params().slug) {
        window.location.replace(
          `/foros/${encodeURIComponent(result.thread.forumSlug)}/${encodeURIComponent(result.thread.id)}`,
        );
        return;
      }
      setData(result);
      setPage(target);
    } catch (error) {
      if (current === revision)
        setLoadError(
          error instanceof ForumRequestError && error.status === 404 ? "missing" : "failed",
        );
    } finally {
      if (current === revision) setLoading(false);
    }
  }
  onSettled(() => {
    void loadThread();
  });

  async function onReply(event: Event) {
    event.preventDefault();
    if (busy()) return;
    setErr("");
    setBusy(true);
    try {
      await forumRequest(`/api/forum/threads/${encodeURIComponent(params().threadId)}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: reply() }),
      });
      setReply("");
      const posts = data()?.posts;
      await loadThread(Math.ceil(((posts?.total ?? 0) + 1) / (posts?.limit ?? 20)));
    } catch (error) {
      setErr(publicationError(error, locale()));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="workspace" data-testid="thread">
      <nav class="breadcrumb" aria-label={t().breadcrumb}>
        <a href="/foros">{t().forums}</a>
        <span aria-hidden="true">/</span>
        <a href={`/foros/${params().slug}`}>
          {forumText(getForum(params().slug)!, locale()).title}
        </a>
      </nav>
      <div class="reading-grid">
        <ForumSidebar current={params().slug} />
        <div>
          <Show when={loading()}>
            <p role="status">{t().loading}</p>
          </Show>
          <Show when={loadError()}>
            <div class="state-panel">
              <h1>{loadError() === "missing" ? t().missingTitle : t().failedTitle}</h1>
              <p role="alert">{loadError() === "missing" ? t().missingBody : t().failedBody}</p>
              <Show when={loadError() === "failed"}>
                <Button
                  fillStyle="outline"
                  onPress={() => {
                    void loadThread();
                  }}
                >
                  {t().retry}
                </Button>
              </Show>
            </div>
          </Show>
          <Show when={!loadError() && data()}>
            {(result) => (
              <>
                <header class="lesson-header">
                  <p class="eyebrow">{t().eyebrow}</p>
                  <h1>{result().thread.title}</h1>
                </header>
                <article class="post">
                  <p class="post__author">
                    {authorName(result().thread.author, locale())}{" "}
                    <span class="discussion-meta">{t().opened}</span>
                  </p>
                  <div class="post__body">{result().thread.content}</div>
                </article>
                <section
                  class="lesson-section"
                  aria-label={t().replies}
                  aria-busy={loading() ? "true" : "false"}
                >
                  <div class="section-heading">
                    <h2>{t().replies}</h2>
                    <p>
                      {result().posts.total} {t().inThread}
                    </p>
                  </div>
                  <For each={result().posts.items}>
                    {(post) => (
                      <article class="post">
                        <p class="post__author">{authorName(post.author, locale())}</p>
                        <div class="post__body">{post.content}</div>
                      </article>
                    )}
                  </For>
                  <Show when={result().posts.total === 0}>
                    <p class="el-muted">{t().empty}</p>
                  </Show>
                  <Show when={result().posts.total > result().posts.limit}>
                    <nav class="pagination" aria-label={t().pages}>
                      <Button
                        fillStyle="outline"
                        isDisabled={page() === 1 || loading()}
                        onPress={() => {
                          void loadThread(page() - 1);
                        }}
                      >
                        {t().previous}
                      </Button>
                      <span>
                        {t().page} {page()}
                      </span>
                      <Button
                        fillStyle="outline"
                        isDisabled={!result().posts.hasMore || loading()}
                        onPress={() => {
                          void loadThread(page() + 1);
                        }}
                      >
                        {t().next}
                      </Button>
                    </nav>
                  </Show>
                </section>
                <section class="composer">
                  <h2>{t().composeTitle}</h2>
                  <SessionGate
                    returnTo={`/foros/${params().slug}/${encodeURIComponent(params().threadId)}`}
                  >
                    <Form onSubmit={onReply} UNSAFE_className="el-form">
                      <TextArea
                        label={t().fieldReply}
                        name="reply-content"
                        value={reply()}
                        onChange={setReply}
                        isRequired
                        maxLength={20_000}
                        data-testid="reply-body"
                      />
                      <Button
                        type="submit"
                        variant="primary"
                        isDisabled={busy()}
                        data-testid="reply-submit"
                      >
                        {busy() ? t().sending : t().publish}
                      </Button>
                      <Show when={err()}>
                        <p class="el-form-msg" role="alert">
                          {err()}
                        </p>
                      </Show>
                    </Form>
                  </SessionGate>
                </section>
              </>
            )}
          </Show>
        </div>
      </div>
    </main>
  );
}
