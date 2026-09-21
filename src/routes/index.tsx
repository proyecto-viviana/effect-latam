import { createFileRoute } from "@tanstack/solid-router";
import { For, createSignal, onCleanup, onSettled } from "solid-js";
import { CommunityAtlas } from "../components/CommunityAtlas";
import { LinkButton } from "../components/ui";
import { routeHead } from "../lib/seo";
import { useCopy } from "../i18n";

export const Route = createFileRoute("/")({
  head: () => routeHead({ path: "/" }),
  component: LandingPage,
});

const copy = {
  es: {
    release: "Effect 4 · recorrido en español",
    title: "TypeScript confiable, en nuestro idioma",
    lead: "Aprendé Effect construyendo. Siete labs ejecutables, artículos honestos y una comunidad latinoamericana para razonar sobre errores, servicios y concurrencia.",
    copied: "Comando copiado",
    copyCommand: "Copiar",
    packageManager: "Gestor de paquetes",
    copyFailed: "No se pudo copiar; seleccioná el comando.",
    included: "// Incluido en el recorrido",
    contents: "Contenido disponible",
    articles: "4 artículos",
    forums: "foros",
    achievements: "logros",
    communityEyebrow: "// Comunidad",
    communityTitle: "Effect desde Latinoamérica",
    communityLead:
      "Registrá tu país, compartí lo que aprendiste y discutí los bordes difíciles con gente que también está construyendo.",
    topics: "Temas del recorrido",
    topicErrors: "Errores",
    topicConcurrency: "Concurrencia",
    routeEyebrow: "// Aprender haciendo",
    routeTitle: "Un recorrido que sí corre",
    routeLead:
      "La teoría llega acompañada de un programa pequeño, una hipótesis y una salida que podés inspeccionar. Sin esconder dónde simplificamos.",
    card1Title: "Describir antes de ejecutar",
    card1Body: "Separá la construcción del programa de su ejecución con Effect.gen.",
    card2Title: "Errores que el tipo recuerda",
    card2Body: "Modelá fallas esperadas y observá cómo se propagan y recuperan.",
    card3Title: "Servicios, fibras y recursos",
    card3Body: "Completá el modelo con Layers, concurrencia, schedules, Schema y scopes.",
    modelEyebrow: "// El modelo mental",
    modelTitle: "Tres canales. Un solo tipo.",
    modelLead:
      "Un Effect cuenta qué produce, cómo puede fallar y qué necesita para poder ejecutarse. El compilador mantiene esa historia visible mientras el programa crece.",
    modelPoint1: "Los errores esperados forman parte de la firma.",
    modelPoint2: "Las dependencias no aparecen por arte de magia.",
    modelPoint3: "La concurrencia y los recursos tienen estructura.",
    modelLink: "Explorar el modelo paso a paso",
    anatomy: "Anatomía del tipo Effect",
    signature: "Effect<Éxito, Error, Requisitos>",
    success: "Éxito",
    successBody: "qué devuelve",
    error: "Error",
    errorBody: "qué puede fallar",
    requirements: "Requisitos",
    requirementsBody: "qué necesita",
    exampleLabel: "Ejemplo de Effect.gen",
    example: `const programa = Effect.gen(function* () {
  const perfil = yield* cargarPerfil
  return perfil.nombre
})`,
    finalTitle: "Menos recetas. Más modelo mental.",
    ctaLearn: "Empezar el recorrido",
    ctaForums: "Visitar los foros",
  },
  pt: {
    release: "Effect 4 · percurso em português",
    title: "TypeScript confiável, no nosso idioma",
    lead: "Aprenda Effect construindo. Sete labs executáveis, artigos honestos e uma comunidade latino-americana para raciocinar sobre erros, serviços e concorrência.",
    copied: "Comando copiado",
    copyCommand: "Copiar",
    packageManager: "Gerenciador de pacotes",
    copyFailed: "Não foi possível copiar; selecione o comando.",
    included: "// Incluído no percurso",
    contents: "Conteúdo disponível",
    articles: "4 artigos",
    forums: "fóruns",
    achievements: "conquistas",
    communityEyebrow: "// Comunidade",
    communityTitle: "Effect a partir da América Latina",
    communityLead:
      "Registre o seu país, compartilhe o que aprendeu e discuta as partes difíceis com gente que também está construindo.",
    topics: "Temas do percurso",
    topicErrors: "Erros",
    topicConcurrency: "Concorrência",
    routeEyebrow: "// Aprender fazendo",
    routeTitle: "Um percurso que roda de verdade",
    routeLead:
      "A teoria vem acompanhada de um programa pequeno, uma hipótese e uma saída que você pode inspecionar. Sem esconder onde simplificamos.",
    card1Title: "Descrever antes de executar",
    card1Body: "Separe a construção do programa da sua execução com Effect.gen.",
    card2Title: "Erros que o tipo lembra",
    card2Body: "Modele falhas esperadas e observe como elas se propagam e se recuperam.",
    card3Title: "Serviços, fibras e recursos",
    card3Body: "Complete o modelo com Layers, concorrência, schedules, Schema e scopes.",
    modelEyebrow: "// O modelo mental",
    modelTitle: "Três canais. Um único tipo.",
    modelLead:
      "Um Effect conta o que produz, como pode falhar e do que precisa para ser executado. O compilador mantém essa história visível enquanto o programa cresce.",
    modelPoint1: "Os erros esperados fazem parte da assinatura.",
    modelPoint2: "As dependências não aparecem por mágica.",
    modelPoint3: "A concorrência e os recursos têm estrutura.",
    modelLink: "Explorar o modelo passo a passo",
    anatomy: "Anatomia do tipo Effect",
    signature: "Effect<Sucesso, Erro, Requisitos>",
    success: "Sucesso",
    successBody: "o que devolve",
    error: "Erro",
    errorBody: "o que pode falhar",
    requirements: "Requisitos",
    requirementsBody: "do que precisa",
    exampleLabel: "Exemplo de Effect.gen",
    example: `const programa = Effect.gen(function* () {
  const perfil = yield* carregarPerfil
  return perfil.nome
})`,
    finalTitle: "Menos receitas. Mais modelo mental.",
    ctaLearn: "Começar o percurso",
    ctaForums: "Visitar os fóruns",
  },
};

const INSTALL_COMMANDS = {
  pnpm: "pnpm add effect@rc",
  npm: "npm install effect@rc",
  yarn: "yarn add effect@rc",
  bun: "bun add effect@rc",
  deno: "deno add npm:effect@rc",
} as const;
type PackageManager = keyof typeof INSTALL_COMMANDS;
const MANAGERS = Object.keys(INSTALL_COMMANDS) as PackageManager[];
const MANAGER_KEY = "el_package_manager";

function LandingPage() {
  const t = useCopy(copy);
  const [manager, setManager] = createSignal<PackageManager>("pnpm");
  const installCommand = () => INSTALL_COMMANDS[manager()];
  const [copyState, setCopyState] = createSignal<"idle" | "copied" | "failed">("idle");
  let copyReset: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => clearTimeout(copyReset));

  // The server always renders pnpm; a remembered choice applies after hydration.
  onSettled(() => {
    try {
      const saved = localStorage.getItem(MANAGER_KEY);
      if (saved && saved in INSTALL_COMMANDS) setManager(saved as PackageManager);
    } catch {
      /* Storage can be blocked; pnpm stays selected. */
    }
  });

  function chooseManager(next: string) {
    if (!(next in INSTALL_COMMANDS)) return;
    setManager(next as PackageManager);
    setCopyState("idle");
    try {
      localStorage.setItem(MANAGER_KEY, next);
    } catch {
      /* The choice still holds for this visit. */
    }
  }

  // Kept out of the JSX: a ternary with call branches hydrates under a different key.
  const installLabel = () =>
    copyState() === "copied" ? t().copied : `${t().copyCommand} ${installCommand()}`;
  const copyIcon = () => (copyState() === "copied" ? "✓" : "⧉");
  const installStatus = () =>
    copyState() === "copied" ? t().copied : copyState() === "failed" ? t().copyFailed : "";

  async function copyInstallCommand() {
    let didCopy = false;

    try {
      await navigator.clipboard.writeText(installCommand());
      didCopy = true;
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = installCommand();
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      fallback.ownerDocument.body.appendChild(fallback);
      fallback.select();
      didCopy = document.execCommand("copy");
      fallback.remove();
    }

    setCopyState(didCopy ? "copied" : "failed");
    clearTimeout(copyReset);
    copyReset = setTimeout(() => setCopyState("idle"), 2_000);
  }

  return (
    <main class="home" data-testid="landing">
      <section class="home-hero" aria-labelledby="home-title">
        <div class="home-grid" aria-hidden="true" />
        <div class="home-hero__inner">
          <a class="home-release" href="/learn">
            <span aria-hidden="true">//</span>
            <span>{t().release}</span>
            <span aria-hidden="true">→</span>
          </a>

          <h1 id="home-title" class="home-hero__title">
            {t().title}
          </h1>
          <p class="home-hero__lead">{t().lead}</p>

          <div class="home-install" data-testid="install">
            <select
              class="home-install__manager"
              aria-label={t().packageManager}
              value={manager()}
              onChange={(event) => chooseManager(event.currentTarget.value)}
              data-testid="install-manager"
            >
              <For each={MANAGERS}>{(name) => <option value={name}>{name}</option>}</For>
            </select>
            <button
              class="home-install__command"
              type="button"
              aria-label={installLabel()}
              onClick={copyInstallCommand}
              data-testid="install-copy"
            >
              <code>{installCommand()}</code>
              <span class="home-install__copy" aria-hidden="true">
                {copyIcon()}
              </span>
            </button>
          </div>
          <span class="home-install__status" role="status" aria-live="polite">
            {installStatus()}
          </span>

          <div class="home-proof">
            <p>{t().included}</p>
            <ul aria-label={t().contents}>
              <li>7 labs</li>
              <li>{t().articles}</li>
              <li>{t().forums}</li>
              <li>{t().achievements}</li>
            </ul>
          </div>
        </div>
      </section>

      <section class="home-community-intro" aria-labelledby="community-title">
        <p class="home-eyebrow">{t().communityEyebrow}</p>
        <h2 id="community-title">{t().communityTitle}</h2>
        <p>{t().communityLead}</p>
      </section>
      <CommunityAtlas />

      <nav class="home-topic-nav" aria-label={t().topics}>
        <a href="/learn/effect-gen-playground">Effect.gen</a>
        <a href="/learn/error-channel">{t().topicErrors}</a>
        <a href="/learn/layer-graph">Layers</a>
        <a href="/learn/fiber-race-all">{t().topicConcurrency}</a>
        <a href="/learn/schema-decode">Schema</a>
      </nav>

      <section class="home-section" aria-labelledby="route-title">
        <header class="home-section__header">
          <p class="home-eyebrow">{t().routeEyebrow}</p>
          <h2 id="route-title">{t().routeTitle}</h2>
          <p>{t().routeLead}</p>
        </header>

        <div class="home-route-grid">
          <a class="home-route-card" href="/learn/effect-gen-playground">
            <span class="home-route-card__index">01</span>
            <div>
              <h3>{t().card1Title}</h3>
              <p>{t().card1Body}</p>
            </div>
            <span class="home-route-card__arrow" aria-hidden="true">
              →
            </span>
          </a>
          <a class="home-route-card" href="/learn/error-channel">
            <span class="home-route-card__index">02</span>
            <div>
              <h3>{t().card2Title}</h3>
              <p>{t().card2Body}</p>
            </div>
            <span class="home-route-card__arrow" aria-hidden="true">
              →
            </span>
          </a>
          <a class="home-route-card" href="/learn/layer-graph">
            <span class="home-route-card__index">03—07</span>
            <div>
              <h3>{t().card3Title}</h3>
              <p>{t().card3Body}</p>
            </div>
            <span class="home-route-card__arrow" aria-hidden="true">
              →
            </span>
          </a>
        </div>
      </section>

      <section class="home-section home-model" aria-labelledby="model-title">
        <div class="home-model__copy">
          <p class="home-eyebrow">{t().modelEyebrow}</p>
          <h2 id="model-title">{t().modelTitle}</h2>
          <p>{t().modelLead}</p>
          <ul>
            <li>{t().modelPoint1}</li>
            <li>{t().modelPoint2}</li>
            <li>{t().modelPoint3}</li>
          </ul>
          <a class="home-text-link" href="/learn">
            {t().modelLink} <span aria-hidden="true">→</span>
          </a>
        </div>

        <div class="home-model__diagram" aria-label={t().anatomy}>
          <code class="home-model__signature">{t().signature}</code>
          <dl>
            <div>
              <dt>{t().success}</dt>
              <dd>{t().successBody}</dd>
            </div>
            <div>
              <dt>{t().error}</dt>
              <dd>{t().errorBody}</dd>
            </div>
            <div>
              <dt>{t().requirements}</dt>
              <dd>{t().requirementsBody}</dd>
            </div>
          </dl>
          <pre aria-label={t().exampleLabel}>
            <code>{t().example}</code>
          </pre>
        </div>
      </section>

      <section class="home-final" aria-labelledby="final-title">
        <p class="home-eyebrow">import &#123; Effect &#125; from &quot;effect&quot;</p>
        <h2 id="final-title">{t().finalTitle}</h2>
        <div class="home-final__actions">
          <span data-testid="cta-learn">
            <LinkButton href="/learn" variant="primary" UNSAFE_className="el-cta-solid">
              {t().ctaLearn}
            </LinkButton>
          </span>
          <span data-testid="cta-forums">
            <LinkButton
              href="/foros"
              variant="secondary"
              fillStyle="outline"
              UNSAFE_className="el-cta-ghost"
            >
              {t().ctaForums}
            </LinkButton>
          </span>
        </div>
      </section>
    </main>
  );
}
