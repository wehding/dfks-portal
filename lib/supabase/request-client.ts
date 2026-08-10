import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { getRequiredEnv } from "@/lib/env";

type PendingCookie = { name: string; value: string; options: CookieOptions };

/**
 * Supabase-klient bundet til en konkret route-request.
 *
 * Route handlers må ikke afhænge af Nexts globale cookies()-kontekst. Den kan
 * forsvinde, når auth-kaldet fortsætter asynkront, og efterlader blandt andet
 * adminmenuen uden rolledata. Eventuelle opdaterede auth-cookies samles her og
 * sættes på det svar, route handleren returnerer.
 */
export function createRequestClient(request: NextRequest) {
  const pendingCookies: PendingCookie[] = [];
  const supabase = createServerClient(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: cookies => {
          pendingCookies.push(...cookies);
        },
      },
    },
  );

  return {
    supabase,
    applyCookies<T extends NextResponse>(response: T): T {
      for (const cookie of pendingCookies) {
        response.cookies.set(cookie.name, cookie.value, cookie.options);
      }
      return response;
    },
  };
}
