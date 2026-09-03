# Kontraktarkivets arbejdskøer

Kontraktarkivet bruger kortlivede serverstyrede snapshots til næste/forrige-navigation,
validering og ejerskab. En kø tilhører én administrator og én aktiv organisation og
udløber efter 24 timer.

Køen gemmer kun kontrakt-id, position, behandlingsstatus og ufølsomme oplysninger om
de anvendte filtre. Rå søgetekst, kontrakttekst, løn, navne og dokumentkilder gemmes
ikke i køtabellerne. Kontraktdata hentes og autoriseres på ny, når en kontrakt åbnes.

Tabellerne er server-only: RLS er aktiveret, browserroller har ingen tabelrettigheder,
og serverhandlingen kontrollerer bruger, organisation og moduladgang igen. En
ejerskabskø kræver særskilt adgang til kontraktejerskab; jurister kan derfor ikke
oprette eller bruge den.

Den historiske ejer-backfill er afsluttet og har ikke længere et interface eller en
serverhandling i appen. En databasetrigger forhindrer, at der oprettes en ny kørsel
for en organisation, der allerede har en historisk kørsel. De eksisterende resultater
og auditspor bevares.

## Rollback

Ved rollback fjernes kønavigationen og de to køtabeller. Det påvirker ikke kontrakter,
ejerskabsbeslutninger eller auditspor, fordi køerne kun er midlertidige snapshots.
Triggeren, der blokerer en ny ejer-backfill, må kun fjernes efter en særskilt
driftsbeslutning; den er uafhængig af køernes levetid.

Produktionsmigration kræver udtrykkelig driftsgodkendelse. Indtil da er status
`implemented`, men ikke `activated` eller `verified` i produktion.
