"use client"

import { useI18n, type Locale } from "@/lib/i18n"
import { Button } from "@/components/ui/button"

export function LanguageToggle() {
    const { locale, setLocale } = useI18n()

    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocale(locale === "da" ? "en" : "da" as Locale)}
            className="h-8 px-2 text-xs font-medium tracking-wide uppercase text-muted-foreground hover:text-foreground"
        >
            {locale === "da" ? "EN" : "DA"}
        </Button>
    )
}
