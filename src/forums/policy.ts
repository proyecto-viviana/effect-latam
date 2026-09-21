import type { AuthUser } from "../auth/session";
import { getForum } from "./registry";

export type ForumAccess = {
  canRead: boolean;
  canCreateThread: boolean;
  canReply: boolean;
  canModerate: boolean;
};

export function forumPolicy(slug: string, user: AuthUser | null): ForumAccess {
  const forum = getForum(slug);
  if (!forum) {
    return {
      canRead: false,
      canCreateThread: false,
      canReply: false,
      canModerate: false,
    };
  }
  const member = !!user;
  const staff = user?.role === "staff";
  return {
    canRead: true,
    canCreateThread: member,
    canReply: member,
    canModerate: staff,
  };
}
