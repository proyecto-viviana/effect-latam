import { For } from "solid-js";
import type { JSX } from "@solidjs/web";

type Children = { children?: JSX.Element };
type UnsafeClassName = { UNSAFE_className?: string };
type DataTestId = { "data-testid"?: string };
type Variant = {
  variant?: "primary" | "secondary" | "neutral";
  fillStyle?: "outline" | "bold" | "subtle";
  size?: "S" | "M" | "L";
};

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function controlClass(
  variant: Variant["variant"],
  fillStyle: Variant["fillStyle"],
  unsafeClassName?: string,
) {
  return classes(
    "el-control",
    variant === "primary" ? "btn-primary" : fillStyle === "outline" ? "btn-ghost" : "btn-secondary",
    unsafeClassName,
  );
}

type LinkProps = Children &
  UnsafeClassName &
  DataTestId &
  Variant &
  Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "class" | "children"> & {
    isStandalone?: boolean;
  };

export function Link(props: LinkProps) {
  return (
    <a
      href={props.href}
      target={props.target}
      rel={props.rel}
      aria-label={props["aria-label"]}
      data-testid={props["data-testid"]}
      class={classes("el-link", props.UNSAFE_className)}
    >
      {props.children}
    </a>
  );
}

export function LinkButton(props: LinkProps) {
  return (
    <a
      href={props.href}
      target={props.target}
      rel={props.rel}
      aria-label={props["aria-label"]}
      data-testid={props["data-testid"]}
      class={controlClass(props.variant, props.fillStyle, props.UNSAFE_className)}
    >
      {props.children}
    </a>
  );
}

type ButtonProps = Children &
  UnsafeClassName &
  DataTestId &
  Variant &
  Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "children" | "disabled"> & {
    isDisabled?: boolean;
    onPress?: () => void;
  };

export function Button(props: ButtonProps) {
  return (
    <button
      type={props.type ?? "button"}
      name={props.name}
      value={props.value}
      disabled={props.isDisabled}
      aria-label={props["aria-label"]}
      data-testid={props["data-testid"]}
      class={controlClass(props.variant, props.fillStyle, props.UNSAFE_className)}
      onClick={props.onPress}
    >
      {props.children}
    </button>
  );
}

type FormProps = Children &
  UnsafeClassName &
  DataTestId &
  Omit<JSX.FormHTMLAttributes<HTMLFormElement>, "class" | "children">;

export function Form(props: FormProps) {
  return (
    <form
      action={props.action}
      method={props.method}
      data-testid={props["data-testid"]}
      class={props.UNSAFE_className}
      onSubmit={props.onSubmit}
    >
      {props.children}
    </form>
  );
}

type FieldProps = UnsafeClassName & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  isRequired?: boolean;
  description?: string;
  maxLength?: number;
  name?: string;
  "data-testid"?: string;
};

export function TextField(props: FieldProps) {
  return (
    <label class={classes("el-field", props.UNSAFE_className)}>
      <span class="el-field__label">{props.label}</span>
      <input
        type="text"
        name={props.name}
        value={props.value}
        required={props.isRequired}
        maxlength={props.maxLength}
        aria-describedby={props.description ? `${props.name ?? "field"}-hint` : undefined}
        data-testid={props["data-testid"]}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
      {props.description ? (
        <span id={`${props.name ?? "field"}-hint`} class="el-field__description">
          {props.description}
        </span>
      ) : null}
    </label>
  );
}

export function TextArea(props: FieldProps) {
  return (
    <label class={classes("el-field", props.UNSAFE_className)}>
      <span class="el-field__label">{props.label}</span>
      <textarea
        name={props.name}
        value={props.value}
        required={props.isRequired}
        maxlength={props.maxLength}
        aria-describedby={props.description ? `${props.name ?? "field"}-hint` : undefined}
        data-testid={props["data-testid"]}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
      {props.description ? (
        <span id={`${props.name ?? "field"}-hint`} class="el-field__description">
          {props.description}
        </span>
      ) : null}
    </label>
  );
}

type Key = string | number;

type PickerProps<T> = {
  label: string;
  items: readonly T[];
  selectedKey?: Key | null;
  onSelectionChange?: (key: Key | null) => void;
  getKey?: (item: T) => Key;
  getTextValue?: (item: T) => string;
};

function defaultItemKey<T>(item: T): Key {
  const candidate = item as { id?: Key; code?: Key };
  return candidate.id ?? candidate.code ?? String(item);
}

function defaultItemText<T>(item: T): string {
  const candidate = item as { name?: string | { es?: string } };
  return typeof candidate.name === "string" ? candidate.name : (candidate.name?.es ?? String(item));
}

export function Picker<T>(props: PickerProps<T>) {
  return (
    <label class="el-field">
      <span class="el-field__label">{props.label}</span>
      <select
        value={props.selectedKey == null ? undefined : String(props.selectedKey)}
        onChange={(event) => props.onSelectionChange?.(event.currentTarget.value)}
      >
        <For each={props.items}>
          {(item) => {
            const key = () => (props.getKey ?? defaultItemKey)(item);
            const text = () => (props.getTextValue ?? defaultItemText)(item);
            return <option value={String(key())}>{text()}</option>;
          }}
        </For>
      </select>
    </label>
  );
}

export function Badge(props: Children & Variant & { count?: number }) {
  return <span class="el-ui-badge">{props.count == null ? props.children : props.count}</span>;
}

export function StatusLight(props: Children & Variant) {
  return (
    <span class="el-status-light">
      <span class="el-status-light__dot" aria-hidden="true" />
      {props.children}
    </span>
  );
}

export function ProgressBar(props: {
  label: string;
  valueLabel?: string;
  value: number;
  maxValue: number;
  size?: "S" | "M" | "L";
}) {
  return (
    <label class="el-progress">
      <span class="el-progress__label">
        <span>{props.label}</span>
        <span>{props.valueLabel}</span>
      </span>
      <progress value={props.value} max={props.maxValue} />
    </label>
  );
}
