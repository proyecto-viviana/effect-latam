/// <reference types="vite/client" />
import { HeadContent, Outlet, Scripts, createRootRoute, useLocation } from "@tanstack/solid-router";
import { HydrationScript } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { Show, createSignal, onSettled } from "solid-js";
import { Badge, Link, LinkButton } from "../components/ui";
import { fetchMe, shouldShowLogin } from "../auth/client-state";
import appCss from "../styles/app.css?url";
import { BrandLogo } from "../components/BrandLogo";
import { LocaleToggle } from "../components/LocaleToggle";
import { HTML_LANG, LocaleProvider, useCopy, useLocale } from "../i18n";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Effect Latam" },
      { property: "og:image", content: "https://effectlatam.com/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#09090b" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
});

const NAV = [
  { href: "/learn", key: "course", testId: "nav-learn" },
  { href: "/foros", key: "forums", testId: "nav-forums" },
  { href: "/logros", key: "achievements", testId: "nav-achievements" },
] as const;

const copy = {
  es: {
    skip: "Ir al contenido",
    announcement: "7 labs ejecutables",
    mainNav: "Navegación principal",
    mobileNav: "Navegación móvil",
    toggleNav: "Alternar navegación",
    nav: { course: "Curso", forums: "Foros", achievements: "Logros" },
    notifs: "Notifs",
    notifications: "Notificaciones",
    sessionErrorTitle: "No pudimos comprobar tu sesión",
    retrySession: "Reintentar sesión",
    profile: "Perfil",
    logout: "Salir",
    login: "Entrar con Viviana",
    about: "Labs, artículos y conversación sobre Effect para la comunidad latinoamericana.",
    learn: "Aprender",
    route: "Recorrido",
    community: "Comunidad",
    officialDocs: "Documentación oficial ↗",
    sourceCode: "Código fuente ↗",
    disclaimer: "Proyecto comunitario no oficial; no afiliado con Effectful Technologies.",
  },
  pt: {
    skip: "Ir para o conteúdo",
    announcement: "7 labs executáveis",
    mainNav: "Navegação principal",
    mobileNav: "Navegação móvel",
    toggleNav: "Alternar navegação",
    nav: { course: "Curso", forums: "Fóruns", achievements: "Conquistas" },
    notifs: "Notifs",
    notifications: "Notificações",
    sessionErrorTitle: "Não conseguimos verificar sua sessão",
    retrySession: "Tentar de novo",
    profile: "Perfil",
    logout: "Sair",
    login: "Entrar com Viviana",
    about: "Labs, artigos e conversa sobre Effect para a comunidade latino-americana.",
    learn: "Aprender",
    route: "Percurso",
    community: "Comunidade",
    officialDocs: "Documentação oficial ↗",
    sourceCode: "Código-fonte ↗",
    disclaimer: "Projeto comunitário não oficial; sem vínculo com a Effectful Technologies.",
  },
};

/** Scroll distance, in pixels, before the top chrome may hide. */
const CHROME_HIDE_AFTER = 120;

function RootComponent() {
  const location = useLocation();
  const t = useCopy(copy);
  const [me, setMe] = createSignal<Awaited<ReturnType<typeof fetchMe>>>();
  const [notifCount, setNotifCount] = createSignal(0);
  const [sessionError, setSessionError] = createSignal(false);
  const [chromeHidden, setChromeHidden] = createSignal(false);

  onSettled(() => {
    document.documentElement.setAttribute("data-hydrated", "true");
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      // Ignore sub-pixel jitter so the chrome does not flicker.
      if (Math.abs(y - lastY) < 4) return;
      setChromeHidden(y > lastY && y > CHROME_HIDE_AFTER);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    void fetchMe()
      .then((result) => {
        setMe(result);
        if (result.authenticated) void loadNotifs().catch(() => {});
      })
      .catch(() => setSessionError(true));
  });

  const authed = () => me()?.authenticated === true;
  const profile = () => {
    const m = me();
    return m && m.authenticated ? m.profile : null;
  };

  async function loadNotifs() {
    if (!authed()) return;
    const res = await fetch("/api/notifications").catch(() => null);
    if (!res) return;
    if (!res.ok) return;
    const data = (await res.json()) as {
      notifications?: { readAt?: string | null }[];
    };
    const unread = (data.notifications ?? []).filter((n) => !n.readAt).length;
    setNotifCount(unread);
  }

  const path = () => location().pathname;
  const loginUrl = () => `/api/auth/login?returnTo=${encodeURIComponent(path())}`;
  const isActive = (href: string) => path() === href || path().startsWith(`${href}/`);

  return (
    <div class="site-shell" data-chrome-hidden={chromeHidden() ? "" : undefined}>
      <a href="#main" class="skip-link">
        {t().skip}
      </a>

      <a class="site-announcement" href="/learn">
        <span>Effect 4 RC</span>
        <span aria-hidden="true">·</span>
        <span>{t().announcement}</span>
        <span aria-hidden="true">→</span>
      </a>

      <header class="site-header">
        <div class="site-header-inner">
          <a class="site-nav-brand" href="/" data-testid="brand-home" aria-label="Effect Latam">
            <BrandLogo decorative />
          </a>

          <nav class="site-nav" aria-label={t().mainNav}>
            <div class="site-nav-start">
              {NAV.map((item) => (
                <a
                  href={item.href}
                  class="site-nav-link"
                  data-active={isActive(item.href) ? "true" : undefined}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  data-testid={item.testId}
                >
                  {t().nav[item.key]}
                </a>
              ))}
              <Show when={authed()}>
                <a
                  href="/notificaciones"
                  class="site-nav-link"
                  data-active={isActive("/notificaciones") ? "true" : undefined}
                  data-testid="nav-notifs"
                >
                  {t().notifs}
                  <Show when={notifCount() > 0}>
                    <Badge size="S" variant="neutral" fillStyle="bold" count={notifCount()} />
                  </Show>
                </a>
              </Show>
            </div>

            <div class="site-nav-end">
              <LocaleToggle />
              <Show when={sessionError()}>
                <a class="site-nav-link" href={path()} title={t().sessionErrorTitle}>
                  {t().retrySession}
                </a>
              </Show>
              <Show when={authed()}>
                <a
                  href="/perfil"
                  class="site-nav-link"
                  data-active={isActive("/perfil") ? "true" : undefined}
                  data-testid="nav-profile"
                >
                  {profile()?.username || t().profile}
                </a>
                <form method="post" action="/api/auth/logout">
                  <button type="submit" class="chip-outline" data-testid="nav-logout">
                    {t().logout}
                  </button>
                </form>
              </Show>
              <Show when={shouldShowLogin(me())}>
                <span data-testid="nav-login">
                  <LinkButton
                    href={loginUrl()}
                    variant="primary"
                    size="M"
                    UNSAFE_className="el-cta-solid"
                  >
                    {t().login}
                  </LinkButton>
                </span>
              </Show>
            </div>
          </nav>

          <details
            class="site-nav-mobile"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary aria-label={t().toggleNav}>
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </summary>
            <nav aria-label={t().mobileNav}>
              <LocaleToggle />
              <Show when={sessionError()}>
                <a href={path()}>{t().retrySession}</a>
              </Show>
              {NAV.map((item) => (
                <a
                  href={item.href}
                  data-active={isActive(item.href) ? "true" : undefined}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  data-testid={`${item.testId}-mobile`}
                >
                  {t().nav[item.key]}
                </a>
              ))}
              <Show when={authed()}>
                <a href="/notificaciones" data-active={isActive("/notificaciones") || undefined}>
                  {t().notifications} {notifCount() > 0 ? `(${notifCount()})` : ""}
                </a>
                <a href="/perfil" data-active={isActive("/perfil") || undefined}>
                  {profile()?.username || t().profile}
                </a>
                <form method="post" action="/api/auth/logout">
                  <button type="submit">{t().logout}</button>
                </form>
              </Show>
              <Show when={shouldShowLogin(me())}>
                <a href={loginUrl()}>{t().login}</a>
              </Show>
            </nav>
          </details>
        </div>
      </header>

      <div class="site-frame site-frame-offset">
        <div id="main" class="site-main" tabindex={-1}>
          <Outlet />
        </div>
        <footer class="site-footer">
          <div class="site-footer__grid">
            <div class="site-footer__about">
              <BrandLogo />
              <p>{t().about}</p>
            </div>
            <div>
              <h2>{t().learn}</h2>
              <a href="/learn">{t().route}</a>
              <a href="/logros">{t().nav.achievements}</a>
            </div>
            <div>
              <h2>{t().community}</h2>
              <a href="/foros">{t().nav.forums}</a>
              <a href="/perfil">{t().profile}</a>
            </div>
            <div>
              <h2>Effect</h2>
              <a href="https://www.effect.website/docs/" rel="noreferrer">
                {t().officialDocs}
              </a>
              <a href="https://github.com/Effect-TS/effect" rel="noreferrer">
                {t().sourceCode}
              </a>
            </div>
          </div>
          <div class="site-footer__bottom">
            <p>{t().disclaimer}</p>
            <Link variant="secondary" href="https://effectlatam.com" isStandalone>
              effectlatam.com
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

function RootDocument(props: { children: JSX.Element }) {
  return (
    <LocaleProvider>
      <HtmlShell>{props.children}</HtmlShell>
    </LocaleProvider>
  );
}

function HtmlShell(props: { children: JSX.Element }) {
  const { locale } = useLocale();
  return (
    <html lang={HTML_LANG[locale()]}>
      <head>
        <meta charset="utf-8" />
        <HydrationScript />
        <HeadContent />
      </head>
      <body>
        {props.children}
        <Scripts />
      </body>
    </html>
  );
}
