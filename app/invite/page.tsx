"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function InviteForm() {
    const router = useRouter()
    const params = useSearchParams()
    const from = params.get("from") ?? "/"

    const [code, setCode] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError("")
        setLoading(true)
        try {
            const res = await fetch("/api/auth/invite", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: code.trim() }),
            })
            if (res.ok) {
                router.push(from)
            } else {
                setError("Ugyldig kode — prøv igen eller kontakt DFKS.")
            }
        } catch {
            setError("Noget gik galt — prøv igen.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
            <div className="w-full max-w-sm space-y-8">
                <div className="flex flex-col items-center gap-4">
                    <Image src="/dfks-logo.png" alt="DFKS" width={120} height={60} className="dark:invert" />
                    <div className="text-center">
                        <h1 className="text-xl font-semibold">Testadgang</h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            Indtast den invite-kode du har modtaget fra DFKS
                        </p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="code">Invite-kode</Label>
                        <Input
                            id="code"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder="dfks-xxxx-xxxx"
                            autoComplete="off"
                            autoFocus
                        />
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <Button type="submit" className="w-full" disabled={loading || !code.trim()}>
                        {loading ? "Verificerer…" : "Få adgang"}
                    </Button>
                </form>

                <p className="text-center text-xs text-muted-foreground">
                    Har du ikke modtaget en kode?{" "}
                    <a href="mailto:dfks@dfks.dk" className="underline underline-offset-4">
                        Kontakt DFKS
                    </a>
                </p>
            </div>
        </div>
    )
}

export default function InvitePage() {
    return (
        <Suspense>
            <InviteForm />
        </Suspense>
    )
}
