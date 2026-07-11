# RLS-adgangsmatrix

Denne matrix beskriver den tilsigtede adgang efter migrationerne fra 11. juli 2026. `Egen organisation` betyder en relation i `user_org_roles`; brugerredigerbar `user_metadata` må aldrig give adgang.

| Dataområde | Anonym | Medlem | Admin/jurist i egen organisation | Admin i anden organisation | Service role |
|---|---|---|---|---|---|
| Organisationer | Ingen | Læs | Læs | Læs | Fuld |
| Rettighedshavere | Ingen | Læs/opdatér egen profil | Læs/opdatér tilknyttede personer | Ingen | Fuld |
| Organisationstilknytninger | Ingen | Læs egne | Administrér i egen organisation | Ingen | Fuld |
| Værker | Ingen | Læs tilknyttede værker | Administrér i egen organisation | Ingen | Fuld |
| Værktilknytninger | Ingen | Læs egne/relevante | Administrér i egen organisation | Ingen | Fuld |
| Kontrakter | Ingen | Læs/opret/opdatér egne | Administrér i egen organisation | Ingen | Fuld |
| Kontraktafsnit | Ingen | Læs for egne kontrakter | Administrér i egen organisation | Ingen | Fuld |
| Kontraktvalideringer og gennemgange | Ingen | Læs egne/relevante | Administrér i egen organisation | Ingen | Fuld |
| Visningskrav | Ingen | Læs/opret egne | Læs i egen organisation | Ingen | Fuld |
| Producenter og producentregistre | Ingen | Læs | Administrér | Administrér, da data er fælles stamdata | Fuld |
| Overenskomstsatser | Ingen | Læs | Administrér | Administrér, da data er fælles stamdata | Fuld |
| Referencedokumenter og juridiske noter | Ingen | Læs fælles og egne organisationsdata | Administrér fælles og egne organisationsdata | Kun fælles data | Fuld |
| Sagserfaringer, analysefeedback og videnbidder | Ingen | Læs fælles og egne organisationsdata | Administrér fælles og egne organisationsdata | Kun fælles data | Fuld |
| Læringsmønstre | Ingen | Læs | Administrér | Administrér, da data er fælles | Fuld |
| Overenskomstuploads | Ingen | Ingen | Administrér | Administrér, da data er fælles adminmateriale | Fuld |

## Autorisationsregler

- Organisationsroller kommer kun fra `user_org_roles`.
- Eget rettighedshaverobjekt bestemmes via `rettighedshavere.user_id = auth.uid()`.
- Værkadgang for medlemmer bestemmes via `work_assignments`.
- Kontraktadgang for medlemmer bestemmes via kontraktens `rights_holder_id`.
- `superadmin` er global; `admin`, `org-admin` og `jurist` er organisationsafgrænsede, medmindre tabellen udtrykkeligt er fælles stamdata.
- Privilegerede hjælpefunktioner ligger i `private` og er ikke eksponeret som Data API-RPC.
- `service_role` må kun bruges server-side og må aldrig ligge i en `NEXT_PUBLIC_`-variabel.
