"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound, Loader2, Save, Shield, User } from "lucide-react";
import { toast } from "sonner";

export default function AdminMinProfilPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  const [userId, setUserId] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [fullName, setFullName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [gender, setGender] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [roles, setRoles] = useState<string[]>([]);
  const [orgName, setOrgName] = useState<string>("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setUserId(user.id);
      setEmail(user.email ?? "");
      const meta = user.user_metadata ?? {};
      setFullName(meta.full_name || meta.name || "");
      setPhone(meta.phone || "");
      setGender(meta.gender || "");
      setTitle(meta.title || "");

      // Hent roller og org
      const { data: roleRows } = await supabase
        .from("user_org_roles")
        .select("role, organisations(name)")
        .eq("user_id", user.id);

      if (roleRows && roleRows.length > 0) {
        setRoles(roleRows.map(r => r.role));
        const org = Array.isArray(roleRows[0].organisations) ? roleRows[0].organisations[0] : roleRows[0].organisations;
        if (org?.name) setOrgName(org.name);
      }

      setLoading(false);
    }
    loadProfile();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error("Navn skal udfyldes");
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        data: {
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          gender: gender || null,
          title: title.trim() || null,
        },
      });

      if (error) throw error;
      toast.success("Din profil er opdateret");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke opdatere profil");
    } finally {
      setSaving(false);
    }
  };

  const handleSendResetEmail = async () => {
    if (!email) return;
    setSendingReset(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/confirm?type=recovery`,
      });
      if (error) throw error;
      toast.success(`Nulstillingslink sendt til ${email}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke sende nulstillingslink");
    } finally {
      setSendingReset(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("Ny adgangskode skal være på mindst 8 tegn");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Adgangskoderne er ikke ens");
      return;
    }
    setPasswordSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Adgangskoden er skiftet");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke skifte adgangskode");
    } finally {
      setPasswordSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Min profil"
        subtitle="Ret dine personlige oplysninger og administrator-adgangskode."
      />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Stamdata */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" /> Stamdata
            </CardTitle>
            <CardDescription>Dine administrator-oplysninger i portalen.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mailadresse</Label>
                <Input id="email" value={email} disabled className="bg-muted" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fullName">Fulde navn</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Fx Anne Jensen"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="title">Stilling / Titel</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Fx Administrator / Jurist"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="phone">Telefonnummer</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="Fx 12 34 56 78"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="gender">Køn</Label>
                <select
                  id="gender"
                  value={gender}
                  onChange={e => setGender(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">– Vælg –</option>
                  <option value="female">Kvinde</option>
                  <option value="male">Mand</option>
                  <option value="non_binary">Nonbinær</option>
                  <option value="other">Andet</option>
                  <option value="prefer_not_to_say">Ønsker ikke at oplyse</option>
                </select>
              </div>

              <Button type="submit" disabled={saving} className="w-full gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Gem oplysninger
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Sikkerhed & Roller */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="h-4 w-4" /> Roller & Organisation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground">Organisation:</span>{" "}
                <span className="font-semibold">{orgName || "Standard Organisation"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Roller:</span>{" "}
                <span className="font-semibold">{roles.join(", ") || "Admin"}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4" /> Adgangskode
              </CardTitle>
              <CardDescription>Skift adgangskode eller modtag nulstillings-link.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleChangePassword} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="newPassword">Ny adgangskode</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Mindst 8 tegn"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Gentag ny adgangskode</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Gentag adgangskode"
                  />
                </div>
                <Button type="submit" disabled={passwordSaving || !newPassword} variant="outline" className="w-full">
                  {passwordSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Opdater adgangskode"}
                </Button>
              </form>

              <div className="pt-3 border-t">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={sendingReset}
                  onClick={handleSendResetEmail}
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                >
                  {sendingReset ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                  Send nulstillings-link til e-mail
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
