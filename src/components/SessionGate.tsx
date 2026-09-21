import type { JSX } from "@solidjs/web";
import { Show, createSignal, onSettled } from "solid-js";
import { fetchMe, type MeResponse } from "../auth/client-state";
import { Button, LinkButton } from "./ui";
import { useCopy } from "../i18n";

const copy = {
  es: {
    checking: "Comprobando tu sesión…",
    title: "Sumate a la conversación",
    body: "Podés leer todos los temas. Entrá con tu cuenta de Viviana para publicar y responder.",
    login: "Entrar para participar",
    failed: "No pudimos comprobar tu sesión.",
    retry: "Reintentar sesión",
  },
  pt: {
    checking: "Verificando sua sessão…",
    title: "Participe da conversa",
    body: "Você pode ler todos os tópicos. Entre com a sua conta Viviana para publicar e responder.",
    login: "Entrar para participar",
    failed: "Não conseguimos verificar sua sessão.",
    retry: "Tentar de novo",
  },
};

/** Session detection is UI only; the API independently authorizes every write. */
export function SessionGate(props: { returnTo: string; children: JSX.Element }) {
  const t = useCopy(copy);
  const [me, setMe] = createSignal<MeResponse>();
  const [failed, setFailed] = createSignal(false);
  async function refresh() {
    setFailed(false);
    try {
      setMe(await fetchMe());
    } catch {
      setFailed(true);
    }
  }
  onSettled(() => {
    void refresh();
  });
  return (
    <Show
      when={me()?.authenticated}
      fallback={
        <aside class="state-panel">
          <Show
            when={failed()}
            fallback={
              <Show when={me()} fallback={<p role="status">{t().checking}</p>}>
                <h2>{t().title}</h2>
                <p>{t().body}</p>
                <LinkButton
                  href={`/api/auth/login?returnTo=${encodeURIComponent(props.returnTo)}`}
                  variant="primary"
                >
                  {t().login}
                </LinkButton>
              </Show>
            }
          >
            <p role="alert">{t().failed}</p>
            <Button
              fillStyle="outline"
              onPress={() => {
                void refresh();
              }}
            >
              {t().retry}
            </Button>
          </Show>
        </aside>
      }
    >
      {props.children}
    </Show>
  );
}
