import { For, Show, createEffect, createMemo, createSignal, onCleanup, onSettled } from "solid-js";
import type { LabMeta } from "../learn/catalog";
import { engineForLab } from "../learn/labs/registry";
import { Button, Picker } from "./ui";
import { useCopy } from "../i18n";

const copy = {
  es: {
    status: {
      idle: "Elegí Describe para leer el plan o Run para ejecutarlo.",
      selected: "Caso seleccionado. Todavía no se ejecutó.",
      described: "Plan del ejemplo · sin ejecutar",
      running: "Ejecutando el programa…",
      ok: "Ejecución terminada · resultado exitoso",
      failed: "Ejecución terminada · el ejemplo devolvió un fallo",
      crashed: "La ejecución no pudo terminar.",
    },
    error: {
      describe: "No se pudo describir el caso. Elegí otro e intentá de nuevo.",
      run: "El laboratorio encontró un error inesperado. Podés volver a ejecutar o elegir otro caso.",
    },
    preset: "Caso de estudio",
    running: "Ejecutando…",
    plan: "Plan del ejemplo",
    trace: "Traza didáctica",
    placeholder: "El resultado va a aparecer acá.",
    result: "Resultado completo · JSON",
  },
  pt: {
    status: {
      idle: "Escolha Describe para ler o plano ou Run para executá-lo.",
      selected: "Caso selecionado. Ainda não foi executado.",
      described: "Plano do exemplo · sem executar",
      running: "Executando o programa…",
      ok: "Execução terminada · resultado bem-sucedido",
      failed: "Execução terminada · o exemplo devolveu uma falha",
      crashed: "A execução não conseguiu terminar.",
    },
    error: {
      describe: "Não foi possível descrever o caso. Escolha outro e tente de novo.",
      run: "O laboratório encontrou um erro inesperado. Você pode executar de novo ou escolher outro caso.",
    },
    preset: "Caso de estudo",
    running: "Executando…",
    plan: "Plano do exemplo",
    trace: "Trace didático",
    placeholder: "O resultado vai aparecer aqui.",
    result: "Resultado completo · JSON",
  },
};

type Status = keyof typeof copy.es.status;
type LabError = keyof typeof copy.es.error;

/** Structural descriptions are authored metadata. Only Run executes the engine. */
export function LabPlayground(props: { lab: LabMeta }) {
  const engine = createMemo(() => engineForLab(props.lab.id));
  const [preset, setPreset] = createSignal(engineForLab(props.lab.id).presetIds[0]!);
  const [output, setOutput] = createSignal<unknown>();
  const t = useCopy(copy);
  const [status, setStatus] = createSignal<Status>("idle");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<LabError>();
  let revision = 0;
  onCleanup(() => {
    revision++;
  });

  function reset(id: string) {
    revision++;
    setPreset(id);
    setOutput(undefined);
    setBusy(false);
    setError(undefined);
    setStatus("selected");
  }
  createEffect(
    () => ({ lab: props.lab.id, first: engine().presetIds[0]! }),
    ({ first }) => reset(first),
  );
  const presetItems = createMemo(() =>
    engine().presetIds.map((id) => ({ id, name: engine().presetLabel(id) })),
  );
  const steps = () => (output() as { steps?: { id: string; label: string }[] } | undefined)?.steps;
  const trace = () =>
    (output() as { trace?: { stepId: string; status: string; detail: string }[] } | undefined)
      ?.trace;

  onSettled(() => {
    void fetch("/api/learn/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId: props.lab.id }),
    }).catch(() => {
      /* Public labs also work offline. */
    });
  });

  function onDescribe() {
    revision++;
    setBusy(false);
    setError(undefined);
    try {
      setOutput(engine().describe(preset()));
      setStatus("described");
    } catch {
      setOutput(undefined);
      setError("describe");
    }
  }

  async function onRun() {
    if (busy()) return;
    const current = ++revision;
    setBusy(true);
    setOutput(undefined);
    setError(undefined);
    setStatus("running");
    try {
      const result = await engine().run(preset());
      if (current !== revision) return;
      setOutput(result);
      setStatus((result as { ok: boolean }).ok ? "ok" : "failed");
    } catch {
      if (current !== revision) return;
      setStatus("crashed");
      setError("run");
    } finally {
      if (current === revision) setBusy(false);
    }
  }

  return (
    <div
      class="lesson-lab"
      data-testid={`lab-${props.lab.id}`}
      aria-busy={busy() ? "true" : "false"}
    >
      <div class="lesson-lab__toolbar">
        <Picker
          label={t().preset}
          items={presetItems()}
          selectedKey={preset()}
          onSelectionChange={(key) => {
            if (key != null) reset(String(key));
          }}
        />
        <div class="lesson-lab__actions">
          <Button fillStyle="outline" onPress={onDescribe} data-testid="lab-describe">
            Describe
          </Button>
          <Button
            variant="primary"
            onPress={() => {
              void onRun();
            }}
            isDisabled={busy()}
            data-testid="lab-run"
          >
            {busy() ? t().running : "Run"}
          </Button>
        </div>
      </div>
      <div class="lesson-lab__status" role="status">
        {t().status[status()]}
      </div>
      <Show when={error()}>
        {(kind) => (
          <p class="state-panel" role="alert">
            {t().error[kind()]}
          </p>
        )}
      </Show>
      <Show when={steps()}>
        {(items) => (
          <ol aria-label={t().plan}>
            <For each={items()}>{(step) => <li>{step.label}</li>}</For>
          </ol>
        )}
      </Show>
      <Show when={trace()}>
        {(items) => (
          <ol aria-label={t().trace}>
            <For each={items()}>
              {(step) => (
                <li>
                  {step.status} · {step.detail}
                </li>
              )}
            </For>
          </ol>
        )}
      </Show>
      <Show
        when={output() !== undefined}
        fallback={<pre data-testid="lab-output">{t().placeholder}</pre>}
      >
        <details open>
          <summary>{t().result}</summary>
          <pre data-testid="lab-output">{JSON.stringify(output(), null, 2)}</pre>
        </details>
      </Show>
    </div>
  );
}
