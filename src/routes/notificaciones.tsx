import { createFileRoute } from "@tanstack/solid-router";
import { For, Show, createSignal, onSettled } from "solid-js";
import { Button, LinkButton, StatusLight } from "../components/ui";
import { routeHead } from "../lib/seo";
import { useCopy } from "../i18n";

const copy = {
  es: {
    title: "Notificaciones",
    login: "Entrar",
    markRead: "Marcar leídas",
    empty: "Sin notificaciones.",
  },
  pt: {
    title: "Notificações",
    login: "Entrar",
    markRead: "Marcar como lidas",
    empty: "Sem notificações.",
  },
};

export const Route = createFileRoute("/notificaciones")({
  head: () => routeHead({ title: "Notificaciones", path: "/notificaciones", noIndex: true }),
  component: NotifsPage,
});

async function load() {
  const res = await fetch("/api/notifications");
  if (res.status === 401) return { auth: false as const };
  if (!res.ok) return { auth: true as const, notifications: [] };
  const data = (await res.json()) as {
    notifications?: {
      id: string;
      type: string;
      readAt?: string | null;
      threadTitle?: string | null;
    }[];
  };
  return {
    auth: true as const,
    notifications: data.notifications ?? [],
  };
}

function NotifsPage() {
  const t = useCopy(copy);
  const [data, setData] = createSignal<Awaited<ReturnType<typeof load>>>();

  async function loadNotifications() {
    setData(await load());
  }

  onSettled(() => {
    void loadNotifications();
  });

  async function markAll() {
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await loadNotifications();
  }

  return (
    <main class="el-main" data-testid="notifs">
      <p class="kicker">// inbox</p>
      <h1 class="el-hero-title">{t().title}</h1>
      <Show when={data()?.auth === false}>
        <LinkButton
          href="/api/auth/login?returnTo=/notificaciones"
          variant="primary"
          UNSAFE_className="el-cta-solid"
        >
          {t().login}
        </LinkButton>
      </Show>
      <Show when={data()?.auth}>
        <Button
          variant="secondary"
          fillStyle="outline"
          UNSAFE_className="el-cta-ghost"
          onPress={() => void markAll()}
        >
          {t().markRead}
        </Button>
        <ul class="el-notif-list">
          <For each={data()!.notifications ?? []}>
            {(n) => (
              <li class={n.readAt ? "el-notif" : "el-notif el-notif--unread"}>
                <StatusLight variant="neutral" size="S">
                  {n.type}
                </StatusLight>
                <Show when={n.threadTitle}>
                  <span> · {n.threadTitle}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
        <Show when={(data()!.notifications ?? []).length === 0}>
          <p class="el-muted">{t().empty}</p>
        </Show>
      </Show>
    </main>
  );
}
