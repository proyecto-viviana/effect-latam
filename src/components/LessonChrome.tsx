import type { JSX } from "@solidjs/web";

export function LessonChrome(props: {
  title: string;
  blurb: string;
  label: string;
  children: JSX.Element;
}) {
  return (
    <article data-testid="lesson-chrome">
      <header class="lesson-header">
        <p class="eyebrow">{props.label}</p>
        <h1>{props.title}</h1>
        <p>{props.blurb}</p>
      </header>
      {props.children}
    </article>
  );
}
