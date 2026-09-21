import type { Locale } from "../i18n/locale";

export class ForumRequestError extends Error {
  constructor(public readonly status: number) {
    super(`Forum request failed (${status})`);
  }
}

export async function forumRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  if (!response.ok) throw new ForumRequestError(response.status);
  return response.json() as Promise<T>;
}

const copy = {
  es: {
    401: "Tu sesión terminó. Volvé a entrar para publicar; tu texto sigue acá.",
    403: "Tu cuenta no tiene permiso para publicar acá.",
    400: "Revisá el título y el contenido: no pueden quedar vacíos.",
    429: "Hay demasiadas publicaciones seguidas. Esperá un momento e intentá de nuevo.",
    other: "No se pudo publicar. Tu texto sigue acá; probá de nuevo.",
    member: "Miembro de la comunidad",
  },
  pt: {
    401: "Sua sessão terminou. Entre de novo para publicar; o seu texto continua aqui.",
    403: "Sua conta não tem permissão para publicar aqui.",
    400: "Confira o título e o conteúdo: não podem ficar vazios.",
    429: "Há publicações demais em sequência. Espere um momento e tente de novo.",
    other: "Não foi possível publicar. O seu texto continua aqui; tente de novo.",
    member: "Membro da comunidade",
  },
};

export function publicationError(error: unknown, locale: Locale = "es"): string {
  const t = copy[locale];
  if (error instanceof ForumRequestError) {
    if (error.status === 401 || error.status === 403) return t[error.status];
    if (error.status === 400 || error.status === 429) return t[error.status];
  }
  return t.other;
}

export type Author = { username?: string | null; name?: string | null };
export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
};
export type ThreadSummary = { id: string; title: string; replyCount: number; author: Author };
export type ThreadDetail = {
  thread: ThreadSummary & { forumSlug: string; content: string };
  posts: PageResult<{ id: string; content: string; author: Author }>;
};
export const authorName = (author: Author, locale: Locale = "es") =>
  author.username || author.name || copy[locale].member;
