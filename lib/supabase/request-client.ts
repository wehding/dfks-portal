import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { getRequiredEnv } from "@/lib/env";
import {
  applyAuthResponse,
  PRIVATE_AUTH_RESPONSE_HEADERS,
  type PendingAuthCookie,
} from "@/lib/supabase/auth-response";

/**
 * Supabase-klient bundet til en konkret route-request.
 *
 * Route handlers må ikke afhænge af Nexts globale cookies()-kontekst. Den kan
 * forsvinde, når auth-kaldet fortsætter asynkront, og efterlader blandt andet
 * adminmenuen uden rolledata. Eventuelle opdaterede auth-cookies samles her og
 * sættes på det svar, route handleren returnerer.
 */
export function createRequestClient(request: NextRequest) {
  const pendingCookies: PendingAuthCookie[] = [];
  let pendingHeaders: Record<string, string> = { ...PRIVATE_AUTH_RESPONSE_HEADERS };
  const supabase = createServerClient(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies, headers) => {
          pendingCookies.push(...cookies);
          pendingHeaders = { ...pendingHeaders, ...headers };
        },
      },
    },
  );

  return {
    supabase,
    applyAuthResponse<T extends NextResponse>(response: T): T {
      return applyAuthResponse(response, pendingCookies, pendingHeaders);
    },
  };
}
