"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageToggle } from "@/components/language-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { validateAccountPassword, type AccountAccessMode, type AccountPasswordError } from "@/lib/auth/account-access";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { setAccountPassword } from "./actions";

export type AccountAccessStatus = "ready" | "invalid_link" | "missing_session" | "missing_org";

type ErrorCode = AccountPasswordError | "missing_session" | "missing_org" | "update_failed";

const ERROR_KEYS: Record<ErrorCode, TranslationKey> = {
  password_required: "accountAccess.errorRequired",
  password_too_short: "accountAccess.errorTooShort",
  password_mismatch: "accountAccess.errorMismatch",
  missing_session: "accountAccess.errorMissingSession",
  missing_org: "accountAccess.errorMissingOrg",
  update_failed: "accountAccess.errorUpdate",
};

export default function AccountAccessClient({
  mode,
  status,
  email,
  logoUrl,
  brand,
}: {
  mode: AccountAccessMode;
  status: AccountAccessStatus;
  email: string;
  logoUrl: string | null;
  brand: { primary_color: string; short_name: string; long_name: string };
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [loading, setLoading] = useState(false);

  const isInvite = mode === "invite";
  const title = isInvite
    ? t("accountAccess.inviteTitle").replace("{org}", brand.long_name)
    : t("accountAccess.recoveryTitle");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const validationError = validateAccountPassword(password, confirmation);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await setAccountPassword({ password, confirmation });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.replace(result.destination);
      router.refresh();
    } catch {
      setError("update_failed");
    } finally {
      setLoading(false);
    }
  }

  const pageError: ErrorCode | "invalid_link" | null =
    status === "ready" ? null : status;
  const pageErrorMessage = pageError === "missing_org"
    ? t("accountAccess.errorMissingOrg")
    : pageError === "missing_session"
      ? t("accountAccess.errorMissingSession")
      : t("accountAccess.invalidDescription");

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="flex items-center justify-end gap-1 p-4">
        <LanguageToggle />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md space-y-6">
          <div className="flex justify-center">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={brand.long_name} className="max-h-24 max-w-64 object-contain" />
            ) : (
              <Image src="/logo.png" alt={brand.long_name} width={220} height={94} className="h-auto max-h-24 w-auto max-w-64 dark:invert" priority />
            )}
          </div>

          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <LockKeyhole className="size-5" aria-hidden="true" />
              </div>
              <CardTitle className="text-xl">{pageError ? t("accountAccess.invalidTitle") : title}</CardTitle>
              <CardDescription>
                {pageError
                  ? pageErrorMessage
                  : t(isInvite ? "accountAccess.inviteDescription" : "accountAccess.recoveryDescription")}
              </CardDescription>
            </CardHeader>

            <CardContent>
              {pageError ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                    {pageError === "invalid_link" ? t("accountAccess.invalidHelp") : pageErrorMessage}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button variant="outline" asChild>
                      <Link href="/">{t("accountAccess.goToLogin")}</Link>
                    </Button>
                    <Button asChild style={{ backgroundColor: brand.primary_color }}>
                      <a href="mailto:dfks@dfks.dk">{t("accountAccess.contact")}</a>
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                  <div className="space-y-2">
                    <Label htmlFor="account-email">{t("auth.email")}</Label>
                    <Input id="account-email" type="email" value={email} readOnly autoComplete="email" className="bg-muted" />
                  </div>

                  <PasswordField
                    id="account-password"
                    label={t("accountAccess.password")}
                    value={password}
                    onChange={value => { setPassword(value); setError(null); }}
                    visible={showPassword}
                    onToggle={() => setShowPassword(current => !current)}
                    toggleLabel={t(showPassword ? "accountAccess.hidePassword" : "accountAccess.showPassword")}
                    describedBy="account-password-help account-password-error"
                    invalid={Boolean(error)}
                  />

                  <PasswordField
                    id="account-password-confirmation"
                    label={t("accountAccess.confirmPassword")}
                    value={confirmation}
                    onChange={value => { setConfirmation(value); setError(null); }}
                    visible={showConfirmation}
                    onToggle={() => setShowConfirmation(current => !current)}
                    toggleLabel={t(showConfirmation ? "accountAccess.hidePassword" : "accountAccess.showPassword")}
                    describedBy="account-password-help account-password-error"
                    invalid={Boolean(error)}
                  />

                  <p id="account-password-help" className="text-xs text-muted-foreground">
                    {t("accountAccess.passwordHelp")}
                  </p>
                  {error && (
                    <p id="account-password-error" className="text-sm text-destructive" role="alert">
                      {t(ERROR_KEYS[error])}
                    </p>
                  )}

                  <Button type="submit" className="w-full" disabled={loading} style={{ backgroundColor: brand.primary_color }}>
                    {loading && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
                    {loading ? t("accountAccess.saving") : t(isInvite ? "accountAccess.createAccess" : "accountAccess.savePassword")}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  visible,
  onToggle,
  toggleLabel,
  describedBy,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  toggleLabel: string;
  describedBy: string;
  invalid: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={event => onChange(event.target.value)}
          autoComplete="new-password"
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="pr-11"
          required
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={toggleLabel}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
