/// <reference types="@cloudflare/workers-types" />
/// <reference types="vite/client" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    AUTH_URL?: string;
    EFFECT_LATAM_CLIENT_ID?: string;
    EFFECT_LATAM_CLIENT_SECRET?: string;
    EFFECT_LATAM_ADMIN_EMAILS?: string;
    EFFECT_LATAM_DEV_AUTH?: string;
  }
}

interface Env extends Cloudflare.Env {}
