import { createFileRoute } from "@tanstack/solid-router";
import { For, Show, createSignal, onSettled } from "solid-js";
import { Badge, LinkButton, ProgressBar } from "../components/ui";
import { routeHead } from "../lib/seo";
import { achievementText } from "../achievements/text";
import { useCopy, useLocale } from "../i18n";

const copy = {
  es: { title: "Logros", login: "Entrar para ver logros", unlocked: "Desbloqueado" },
  pt: { title: "Conquistas", login: "Entrar para ver as conquistas", unlocked: "Desbloqueada" },
};

export const Route = createFileRoute("/logros")({
  head: () => routeHead({ title: "Logros", path: "/logros", noIndex: true }),
  component: LogrosPage,
});

async function load() {
  const res = await fetch("/api/achievements");
  if (res.status === 401) return { auth: false as const };
  if (!res.ok) return { auth: true as const, achievements: [] };
  const data = (await res.json()) as {
    achievements?: {
      id: string;
      title: string;
      description: string;
      unlocked: boolean;
      progress?: { current: number; target: number } | null;
    }[];
  };
  return {
    auth: true as const,
    achievements: data.achievements ?? [],
  };
}

function LogrosPage() {
  const t = useCopy(copy);
  const { locale } = useLocale();
  const [data, setData] = createSignal<Awaited<ReturnType<typeof load>>>();
  onSettled(() => {
    void load().then(setData);
  });

  return (
    <main class="el-main" data-testid="logros">
      <p class="kicker">// achievements</p>
      <h1 class="el-hero-title">{t().title}</h1>
      <Show when={data()?.auth === false}>
        <p>
          <LinkButton
            href="/api/auth/login?returnTo=/logros"
            variant="primary"
            UNSAFE_className="el-cta-solid"
          >
            {t().login}
          </LinkButton>
        </p>
      </Show>
      <Show when={data()?.auth}>
        <ul class="el-ach-list">
          <For each={data()!.achievements ?? []}>
            {(a) => (
              <li class={a.unlocked ? "el-ach el-ach--on" : "el-ach"} data-testid={`ach-${a.id}`}>
                <strong>{achievementText(a, locale()).title}</strong>
                <span>{achievementText(a, locale()).description}</span>
                <Show when={a.unlocked}>
                  <Badge size="S" variant="neutral" fillStyle="bold">
                    {t().unlocked}
                  </Badge>
                </Show>
                <Show when={a.progress}>
                  <ProgressBar
                    label={`${a.progress!.current}/${a.progress!.target}`}
                    valueLabel={`${a.progress!.current}/${a.progress!.target}`}
                    value={a.progress!.current}
                    maxValue={a.progress!.target}
                    size="S"
                  />
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </main>
  );
}
