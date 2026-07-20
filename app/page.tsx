"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { useI18n } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ThemeToggle } from "@/components/theme-toggle"
import { LanguageToggle } from "@/components/language-toggle"
import { createClient } from "@/lib/supabase/client"
import { resolvePostLoginDestination } from "@/lib/auth/post-login"

const TEST_MEMBER = { email: "test@dfks.dk", password: "test1234" }

export default function LoginPage() {
    const { t } = useI18n()
    const router = useRouter()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)
    const isDev = process.env.NODE_ENV === "development"
    const missingSupabaseConfig =
        !process.env.NEXT_PUBLIC_SUPABASE_URL ||
        !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const [resettingOnboarding, setResettingOnboarding] = useState(false)
    const [brand, setBrand] = useState({
        logo_url: null as string | null,
        short_name: "DFKS",
        long_name: "Dansk Filmklipperselskab",
        primary_color: "#111827",
    })

    useEffect(() => {
        const orgId = new URLSearchParams(window.location.search).get("org")
        if (!orgId) return
        void fetch(`/api/public/branding?org=${encodeURIComponent(orgId)}`)
            .then(response => response.ok ? response.json() : null)
            .then(nextBrand => {
                if (nextBrand) setBrand(nextBrand)
            })
    }, [])

    const handleResetOnboarding = async () => {
        if (missingSupabaseConfig) {
            toast.error("Supabase mangler lokal opsætning i .env.local")
            return
        }
        setResettingOnboarding(true)
        try {
            const res = await fetch("/api/dev/reset-onboarding", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: TEST_MEMBER.email }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            toast.success(data.message)

            // Log ind som testbrugeren automatisk
            const supabase = createClient()
            const { error: authError } = await supabase.auth.signInWithPassword(TEST_MEMBER)
            if (authError) {
                toast.error(`Login fejlede: ${authError.message}`)
                return
            }

            // Gå til /onboarding
            router.push("/onboarding")
            router.refresh()
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : "Ukendt fejl")
        } finally {
            setResettingOnboarding(false)
        }
    }

    const handleDevLogin = async (type: "member" | "admin") => {
        if (missingSupabaseConfig) {
            setError("Supabase mangler lokal opsætning. Tilføj NEXT_PUBLIC_SUPABASE_URL og NEXT_PUBLIC_SUPABASE_ANON_KEY i .env.local.")
            return
        }
        setLoading(true)
        const creds = type === "admin"
            ? { email: "wehding@gmail.com", password: "" }
            : TEST_MEMBER
        setEmail(creds.email)
        setPassword(creds.password)
        const supabase = createClient()
        const { error: authError } = await supabase.auth.signInWithPassword(creds)
        if (authError) { setError(authError.message); setLoading(false); return }
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setError("Kunne ikke hente den indloggede bruger."); setLoading(false); return }
        router.push(await resolvePostLoginDestination(supabase, user.id))
        router.refresh()
    }

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")

        if (missingSupabaseConfig) {
            setError("Supabase mangler lokal opsætning. Tilføj NEXT_PUBLIC_SUPABASE_URL og NEXT_PUBLIC_SUPABASE_ANON_KEY i .env.local.")
            return
        }

        setLoading(true)

        const supabase = createClient()
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

        if (authError) {
            setError("Forkert e-mail eller adgangskode.")
            setLoading(false)
            return
        }

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setError("Kunne ikke hente den indloggede bruger."); setLoading(false); return }
        router.push(await resolvePostLoginDestination(supabase, user.id))
        router.refresh()
    }

    return (
        <div className="flex min-h-svh flex-col">
            <header className="flex items-center justify-end gap-1 p-4">
                <LanguageToggle />
                <ThemeToggle />
            </header>

            <main className="flex flex-1 items-center justify-center px-4">
                <div className="w-full max-w-sm space-y-8">
                    <div className="flex flex-col items-center gap-6">
                        {brand.logo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={brand.logo_url} alt={brand.long_name} className="max-h-[120px] max-w-[280px] object-contain" />
                        ) : (
                            <Image
                                src="/logo.png"
                                alt={brand.long_name}
                                width={280}
                                height={120}
                                className="dark:invert"
                                priority
                            />
                        )}
                        <div className="text-center">
                            <h1 className="text-xl font-semibold tracking-tight">
                                {t("auth.welcome")}
                            </h1>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {t("auth.subtitle")}
                            </p>
                        </div>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">{t("auth.email")}</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="navn@eksempel.dk"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoComplete="email"
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="password">{t("auth.password")}</Label>
                                <button
                                    type="button"
                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {t("auth.forgotPassword")}
                                </button>
                            </div>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="current-password"
                            />
                        </div>
                        {error && (
                            <p className="text-sm text-destructive">{error}</p>
                        )}
                        <Button type="submit" className="w-full" disabled={loading} style={{ backgroundColor: brand.primary_color }}>
                            {loading ? "Logger ind…" : t("auth.login")}
                        </Button>
                    </form>

                    {missingSupabaseConfig && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                            Supabase mangler lokal opsætning. Tilføj <span className="font-mono">NEXT_PUBLIC_SUPABASE_URL</span> og <span className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> i <span className="font-mono">.env.local</span>, og genstart appen.
                        </div>
                    )}

                    {isDev && (
                        <div className="border-t pt-4 mt-2 flex flex-col gap-2">
                            <p className="text-xs text-center text-muted-foreground font-mono">DEV</p>
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" className="flex-1 text-xs" onClick={() => handleDevLogin("member")} disabled={loading}>
                                    👤 Test member
                                </Button>
                                <Button type="button" variant="outline" className="flex-1 text-xs" onClick={() => { setEmail("wehding@gmail.com"); setPassword("") }} disabled={loading}>
                                    🔑 Admin (udfyld pw)
                                </Button>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                className="w-full text-xs text-muted-foreground"
                                onClick={handleResetOnboarding}
                                disabled={resettingOnboarding}
                            >
                                {resettingOnboarding ? "Nulstiller…" : "↺ Nulstil testbruger & start onboarding"}
                            </Button>
                        </div>
                    )}

                    <div className="border-t pt-6 mt-2">
                        <a
                            href="/indbetalinger"
                            className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-foreground/50 hover:text-foreground"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                            Indbetalingsskema for producenter
                        </a>
                    </div>
                </div>
            </main>
        </div>
    )
}
