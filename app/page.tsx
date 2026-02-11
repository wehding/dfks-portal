"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import Image from "next/image"
import { useI18n } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ThemeToggle } from "@/components/theme-toggle"
import { LanguageToggle } from "@/components/language-toggle"

export default function LoginPage() {
  const { t } = useI18n()
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    // TODO: Real auth with Supabase
    if (email.includes("admin")) {
      router.push("/admin/kontrakter")
    } else {
      router.push("/portal/mine-vaerker")
    }
  }

  return (
    <div className="flex min-h-svh flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-end gap-1 p-4">
        <LanguageToggle />
        <ThemeToggle />
      </header>

      {/* Center content */}
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-8">
          {/* Logo */}
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

          {/* Form */}
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
              />
            </div>
            <Button type="submit" className="w-full">
              {t("auth.login")}
            </Button>
          </form>

          {/* Hint for demo */}
          <p className="text-center text-xs text-muted-foreground">
            Brug &quot;admin@&quot; i email for admin-adgang
          </p>
        </div>
      </main>
    </div>
  )
}
