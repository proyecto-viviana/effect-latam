import { For, Show } from "solid-js";
import { FORUMS, forumText } from "../forums/registry";
import { LABS } from "../learn/catalog";
import { guideForLab } from "../learn/course";
import { useCopy, useLocale, useText } from "../i18n";

const copy = {
  es: { title: "Espacios de conversación", nav: "Foros por tema", before: "Antes de preguntar" },
  pt: { title: "Espaços de conversa", nav: "Fóruns por tema", before: "Antes de perguntar" },
};

export function ForumSidebar(props: { current?: string }) {
  const t = useCopy(copy);
  const text = useText();
  const { locale } = useLocale();
  const related = () => LABS.filter((lab) => guideForLab(lab.id).forum === props.current);
  return (
    <aside class="course-sidebar">
      <h2>{t().title}</h2>
      <nav aria-label={t().nav}>
        <For each={FORUMS}>
          {(forum) => (
            <a
              href={`/foros/${forum.slug}`}
              aria-current={props.current === forum.slug ? "page" : undefined}
            >
              {forumText(forum, locale()).title}
            </a>
          )}
        </For>
      </nav>
      <Show when={related().length}>
        <div class="community-note">
          <h2>{t().before}</h2>
          <For each={related()}>
            {(lab) => (
              <p>
                <a href={`/learn/${lab.slug}`}>{text(lab.title)} ↗</a>
              </p>
            )}
          </For>
        </div>
      </Show>
    </aside>
  );
}
