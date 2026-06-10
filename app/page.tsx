"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { useI18n } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ThemeToggle } from "@/components/theme-toggle"
import { LanguageToggle } from "@/components/language-toggle"
import { createClient } from "@/lib/supabase/client"

export default function LoginPage() {
    const { t } = useI18n()
    const router = useRouter()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setLoading(true)

        const supabase = createClient()
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

        if (authError) {
            setError("Forkert e-mail eller adgangskode.")
            setLoading(false)
            return
        }

        // Hent brugerens rolle og redirect til relevant portal
        const { data: { user } } = await supabase.auth.getUser()
        const role = user?.user_metadata?.role ?? "member"

        if (role === "admin" || role === "org-admin" || role === "superadmin") {
            router.push("/admin/kontraktgennemgang")
        } else {
            // Tjek om onboarding er gennemført
            const { data: rh } = await supabase
                .from("rettighedshavere")
                .select("onboarding_completed")
                .eq("user_id", user!.id)
                .single()
            router.push(rh?.onboarding_completed ? "/portal/mine-vaerker" : "/onboarding")
        }
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
                        <Image
                            src="/logo.png"
                            alt="Dansk Filmklipperselskab"
                            width={280}
                            height={120}
                            className="dark:invert"
                            priority
                        />
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
                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? "Logger ind…" : t("auth.login")}
                        </Button>
                    </form>

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
