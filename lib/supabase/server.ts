import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { getRequiredEnv } from "@/lib/env"

export async function createClient() {
    const cookieStore = await cookies()
    return createServerClient(
        getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
        getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
        {
            cookies: {
                getAll() { return cookieStore.getAll() },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    } catch {
                        // Server Component — cookies sættes i middleware i stedet
                    }
                },
            },
        }
    )
}
