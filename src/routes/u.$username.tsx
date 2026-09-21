import { createFileRoute } from "@tanstack/solid-router";
import { For, Show, createSignal, onSettled } from "solid-js";
import { Badge } from "../components/ui";
import { routeHead } from "../lib/seo";
import { achievementText } from "../achievements/text";
import { useCopy, useLocale } from "../i18n";

const copy = {
  es: {
    missing: "Usuario no encontrado.",
    publicProfile: "perfil público",
    achievements: "Logros",
  },
  pt: {
    missing: "Usuário não encontrado.",
    publicProfile: "perfil público",
    achievements: "Conquistas",
  },
};

export const Route = createFileRoute("/u/$username")({
  head: ({ params }) =>
    routeHead({
      title: `@${params.username}`,
      path: `/u/${encodeURIComponent(params.username)}`,
    }),
  component: PublicProfile,
});

async function load(username: string) {
  const res = await fetch(`/api/users/${encodeURIComponent(username)}`);
  if (!res.ok) return null;
  return res.json() as Promise<{
    profile: {
      username: string;
      name: string | null;
      countryCode: string | null;
    };
    achievements: { id: string; title: string; unlocked: boolean }[];
  }>;
}

function PublicProfile() {
  const params = Route.useParams();
  const t = useCopy(copy);
  const { locale } = useLocale();
  const [data, setData] = createSignal<Awaited<ReturnType<typeof load>>>();
  const [loading, setLoading] = createSignal(true);
  onSettled(() => {
    void load(params().username).then((result) => {
      setData(result);
      setLoading(false);
    });
  });

  return (
    <main class="el-main" data-testid="public-profile">
      <Show when={loading()}>
        <p>…</p>
      </Show>
      <Show when={data() === null}>
        <p>{t().missing}</p>
      </Show>
      <Show when={data()}>
        {(d) => (
          <>
            <p class="kicker">
              {d().profile.countryCode ?? "—"} · {t().publicProfile}
            </p>
            <h1 class="el-hero-title">@{d().profile.username}</h1>
            <p class="el-hero-lead">{d().profile.name}</p>
            <h2 class="el-section-title">{t().achievements}</h2>
            <ul class="el-badge-list">
              <For each={d().achievements.filter((a) => a.unlocked)}>
                {(a) => (
                  <li title={a.id}>
                    <Badge size="M" variant="neutral" fillStyle="subtle">
                      {achievementText({ ...a, description: "" }, locale()).title}
                    </Badge>
                  </li>
                )}
              </For>
            </ul>
          </>
        )}
      </Show>
    </main>
  );
}
