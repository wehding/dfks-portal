import { redirect } from "next/navigation";

// Medlemsbeskeder er integreret på admin-Overblik (/admin).
// Denne side består kun som redirect for gamle links.
export default function LegacyAdminBeskederRedirect() {
  redirect("/admin");
}
