export type MeResponse =
  | { authenticated: false }
  | {
      authenticated: true;
      profile: {
        id: string;
        username: string | null;
        name: string | null;
        countryCode: string | null;
        role: string;
      };
    };

export async function fetchMe(): Promise<MeResponse> {
  const response = await fetch("/api/auth/me", { cache: "no-store" });
  if (!response.ok) throw new Error("Session service unavailable");
  return response.json();
}

export function shouldShowLogin(me: MeResponse | undefined): boolean {
  return me?.authenticated === false;
}
