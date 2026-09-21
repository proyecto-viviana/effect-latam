import { createFileRoute } from "@tanstack/solid-router";
import { Show, createSignal, onSettled } from "solid-js";
import { LATAM_COUNTRIES } from "../lib/countries";
import { Button, Form, Link, LinkButton, Picker, TextField } from "../components/ui";
import { routeHead } from "../lib/seo";
import { useCopy, useText } from "../i18n";

const copy = {
  es: {
    title: "Perfil",
    login: "Entrar para editar perfil",
    name: "Nombre",
    usernameHelp: "3–20 caracteres: letras, números o _",
    country: "País",
    saving: "Guardando…",
    save: "Guardar",
    saved: "Guardado.",
    network: "Error: no se pudo conectar. Probá de nuevo.",
    public: "Público:",
  },
  pt: {
    title: "Perfil",
    login: "Entrar para editar o perfil",
    name: "Nome",
    usernameHelp: "3–20 caracteres: letras, números ou _",
    country: "País",
    saving: "Salvando…",
    save: "Salvar",
    saved: "Salvo.",
    network: "Erro: não foi possível conectar. Tente de novo.",
    public: "Público:",
  },
};

type SaveMessage = { kind: "saved" } | { kind: "network" } | { kind: "server"; detail: string };

export const Route = createFileRoute("/perfil")({
  head: () => routeHead({ title: "Perfil", path: "/perfil", noIndex: true }),
  component: PerfilPage,
});

type Me =
  | { authenticated: false }
  | {
      authenticated: true;
      profile: {
        username: string | null;
        countryCode: string | null;
        name: string | null;
      };
    };

async function fetchMe(): Promise<Me> {
  const res = await fetch("/api/auth/me", { cache: "no-store" });
  return res.json();
}

function PerfilPage() {
  const t = useCopy(copy);
  const text = useText();
  const [me, setMe] = createSignal<Me>();
  const [loading, setLoading] = createSignal(true);
  const [username, setUsername] = createSignal("");
  const [country, setCountry] = createSignal("UY");
  const [name, setName] = createSignal("");
  const [msg, setMsg] = createSignal<SaveMessage>();
  const [busy, setBusy] = createSignal(false);

  async function loadProfile() {
    setLoading(true);
    const current = await fetchMe();
    setMe(current);
    if (current.authenticated) {
      setUsername(current.profile.username ?? "");
      setCountry(current.profile.countryCode ?? "UY");
      setName(current.profile.name ?? "");
    }
    setLoading(false);
  }

  onSettled(() => {
    void loadProfile();
  });

  async function onSave(e: Event) {
    e.preventDefault();
    if (busy()) return;
    setBusy(true);
    setMsg(undefined);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username(),
          countryCode: country(),
          name: name(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMsg({ kind: "server", detail: String((err as { error?: string }).error ?? res.status) });
        return;
      }
      setMsg({ kind: "saved" });
      await loadProfile();
    } catch {
      setMsg({ kind: "network" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="el-main" data-testid="perfil">
      <p class="kicker">// profile</p>
      <h1 class="el-hero-title">{t().title}</h1>
      <Show when={loading()}>
        <p>…</p>
      </Show>
      <Show when={me() && !me()!.authenticated}>
        <p>
          <LinkButton
            href="/api/auth/login?returnTo=/perfil"
            variant="primary"
            UNSAFE_className="el-cta-solid"
          >
            {t().login}
          </LinkButton>
        </p>
      </Show>
      <Show when={me()?.authenticated}>
        <Form onSubmit={onSave} UNSAFE_className="el-form">
          <TextField label={t().name} value={name()} onChange={setName} maxLength={80} />
          <TextField
            label="Username"
            value={username()}
            onChange={setUsername}
            isRequired
            maxLength={20}
            description={t().usernameHelp}
            data-testid="profile-username"
          />
          <div data-testid="profile-country" class="el-country-picker">
            <Picker
              label={t().country}
              items={[...LATAM_COUNTRIES]}
              getKey={(c) => c.code}
              getTextValue={(c) => text(c.name)}
              selectedKey={country()}
              onSelectionChange={(key) => {
                if (key != null) setCountry(String(key));
              }}
            />
          </div>
          <span data-testid="profile-save">
            <Button
              type="submit"
              variant="primary"
              isDisabled={busy()}
              UNSAFE_className="el-cta-solid"
            >
              {busy() ? t().saving : t().save}
            </Button>
          </span>
          <Show when={msg()}>
            {(m) => {
              const current = m();
              return (
                <p class="el-form-msg" role="status">
                  {current.kind === "server" ? `Error: ${current.detail}` : t()[current.kind]}
                </p>
              );
            }}
          </Show>
          <Show when={username()}>
            <p>
              {t().public}{" "}
              <Link variant="secondary" href={`/u/${username()}`}>
                /u/{username()}
              </Link>
            </p>
          </Show>
        </Form>
      </Show>
    </main>
  );
}
