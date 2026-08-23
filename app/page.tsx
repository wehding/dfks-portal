"use client"

import { useEffect, useState } from "react"
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

export default function LoginPage() {
    const { t } = useI18n()
    const router = useRouter()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [notice, setNotice] = useState("")
    const [loading, setLoading] = useState(false)
    const missingSupabaseConfig =
        !process.env.NEXT_PUBLIC_SUPABASE_URL ||
        !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const [brand, setBrand] = useState({
        logo_url: null as string | null,
        short_name: "DFKS",
        long_name: "Dansk Filmklipperselskab",
        primary_color: "#111827",
    })

    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        if (params.get("notice") === "session-expired") {
            setNotice(t("auth.sessionExpired"))
            window.history.replaceState(null, "", window.location.pathname)
        }
        const orgId = params.get("org")
        if (!orgId) return
        void fetch(`/api/public/branding?org=${encodeURIComponent(orgId)}`)
            .then(response => response.ok ? response.json() : null)
            .then(nextBrand => {
                if (nextBrand) setBrand(nextBrand)
            })
    }, [t])

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
        router.push(await resolvePostLoginDestination(supabase, user.id, user.last_sign_in_at))
        router.refresh()
    }

    const handlePasswordReset = async () => {
        setError("")
        setNotice("")
        if (!email.trim()) {
            setError("Indtast din e-mailadresse først.")
            return
        }
        setLoading(true)
        try {
            const response = await fetch("/api/auth/request-password-reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            })
            const body = await response.json() as { message?: string }
            setNotice(body.message ?? "Hvis e-mailadressen findes, sender vi et nulstillingslink.")
        } catch {
            setError("Nulstillingslinket kunne ikke bestilles. Prøv igen senere.")
        } finally {
            setLoading(false)
        }
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
                                height={93}
                                sizes="280px"
                                className="h-[93px] w-[280px] object-contain dark:invert"
                                preload
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
                                    onClick={() => void handlePasswordReset()}
                                    disabled={loading}
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
                        {notice && (
                            <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">{notice}</p>
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

                </div>
            </main>
        </div>
    )
}
