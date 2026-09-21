import { For } from "solid-js";
import { LABS } from "../learn/catalog";
import { useCopy, useText } from "../i18n";

const copy = {
  es: { title: "El recorrido", nav: "Lecciones del curso" },
  pt: { title: "O percurso", nav: "Lições do curso" },
};

export function CourseSidebar(props: { current?: string }) {
  const t = useCopy(copy);
  const text = useText();
  return (
    <aside class="course-sidebar">
      <h2>{t().title}</h2>
      <nav aria-label={t().nav}>
        <For each={LABS}>
          {(lab, index) => (
            <a
              href={`/learn/${lab.slug}`}
              aria-current={props.current === lab.id ? "page" : undefined}
            >
              <span>{String(index() + 1).padStart(2, "0")}</span>
              {text(lab.title)}
            </a>
          )}
        </For>
      </nav>
    </aside>
  );
}
