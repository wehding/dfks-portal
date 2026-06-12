# DFKS Kontraktportal — Designguide

> Dette dokument beskriver det visuelle sprog der er etableret i portalen.
> Følg disse retningslinjer konsekvent i nye komponenter og sider — både admin og member-portal.

---

## Grundprincipper

- **Monokromt og diskret** — farver reserveres til meningsfulde states (kritisk fejl, bekræftelse). Tal og indhold har ingen accent-farve.
- **Tæt og informationsrigt** — kompakt padding, lille typografi, ingen unødvendig luft.
- **Konsistent hierarki** — én H1 per side, subtitles i `text-gray-500`, labels i normal case.
- **Shadcn/ui som komponentbase** — brug shadcn-komponenter frem for rå HTML-elementer og inline styles.

---

## Farvepalette (Tailwind tokens)

| Rolle | Tailwind-klasse | Hex |
|---|---|---|
| Primær tekst | `text-gray-900` | `#111827` |
| Sekundær tekst / labels | `text-gray-500` | `#6B7280` |
| Deaktiveret / placeholders | `text-gray-400` | `#9CA3AF` |
| Side-baggrund | `bg-white` | `#FFFFFF` |
| Tabel hover | `hover:bg-gray-50` | `#F9FAFB` |
| Kort/boks border | `border border-gray-200 rounded-lg` | — |
| Tabel-rækker border | `border-b border-gray-100` | — |

### Reserverede farver (brug sparsomt)

| Situation | Farve |
|---|---|
| Kritisk fejl / destruktiv handling | `text-red-600` / `bg-red-50` |
| Advarsel / reminder-state | `text-amber-600 border-amber-300` |
| Bekræftelse / godkendt | `text-emerald-600 border-emerald-200` |

**Aldrig:** grøn eller orange på statistik-tal. Tal vises altid i `text-gray-900`.

---

## Typografi

```
H1:       text-2xl font-bold text-gray-900         (sideoverskrift)
Subtitle: text-sm text-gray-500 mt-1               (beskrivelse under H1)
Labels:   text-sm font-medium text-gray-500        (kolonnehoveder, form-labels)
Body:     text-sm text-gray-900                    (tabelindhold)
Meta:     text-xs text-gray-500                    (dato, hjælpetekst)
```

- **Normal case overalt** — ingen `uppercase` eller `tracking-wider` på labels og kolonnehoveder.
- **Aldrig breadcrumbs** — `DFKS > MINE KONTRAKTER`-mønsteret bruges ikke. H1 + subtitle er tilstrækkeligt.

---

## Page-header mønster

```tsx
<h1 className="text-2xl font-bold text-gray-900">Sidetitel</h1>
<p className="text-sm text-gray-500 mt-1">Kort beskrivelse af siden.</p>
```

Brug `<PageHeader title="..." subtitle="..." />` komponenten i admin-sider.

---

## Statistik-blokke

```tsx
<div className="grid grid-cols-3 gap-4">
  <div className="rounded-lg border border-gray-200 bg-white px-6 py-5">
    <p className="text-sm font-medium text-gray-500">Label</p>
    <p className="text-3xl font-bold text-gray-900">{value}</p>
  </div>
</div>
```

- Tal altid i `text-gray-900` — ingen farve-accent uanset om tallet er "godt" eller "dårligt".
- Labels i normal case, `text-sm font-medium text-gray-500`.

---

## Tabeller

### Kolonne-headers

```tsx
<th className="px-4 py-2.5 text-left text-sm font-medium text-gray-500">Kolonnenavn</th>
```

- Normal case — **ikke** `uppercase` eller `tracking-wider`.
- `text-sm font-medium text-gray-500`.

### Rækker

```tsx
<tr className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
  <td className="px-4 py-3 text-sm text-gray-900">...</td>
</tr>
```

- Padding: `py-3 px-4` — ikke `py-4` eller `py-5`.
- Border: `border-b border-gray-100` (den tyndeste variant).
- Hover: `hover:bg-gray-50`.

### Thumbnail / ikon-kolonne

Brug et Lucide-ikon (`<Film size={16} />` eller `<FileText size={16} />`) i `text-gray-400` i stedet for en stor tom placeholder-boks.

```tsx
<td className="px-4 py-3 w-10">
  {posterUrl
    ? <img src={posterUrl} className="w-8 h-11 rounded object-cover" />
    : <Film size={16} className="text-gray-400" />
  }
</td>
```

### Tom state

```tsx
<div className="py-12 text-center text-sm text-gray-500">
  <Film className="mx-auto h-10 w-10 text-gray-300 mb-3" />
  Ingen resultater fundet.
</div>
```

---

## Badges og status

```tsx
// Aktiv / OK
<Badge variant="outline" className="text-xs border-gray-300 text-gray-600">OK</Badge>

// Advarsel / mangler (reminder — ikke fejl)
<Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Mangler</Badge>

// Afsluttet / godkendt
<Badge variant="outline" className="text-xs text-emerald-600 border-emerald-200">Afsluttet</Badge>

// Kritisk
<Badge variant="destructive" className="text-xs">Kritisk</Badge>
```

**Rød er reserveret til egentlige fejl.** En "mangler"-state (fx manglende kontrakt) er amber, ikke rød.

---

## Knapper

```tsx
// Primær
<Button className="bg-gray-900 text-white hover:bg-gray-700">Gem</Button>

// Sekundær / outline
<Button variant="outline" className="border-gray-300 text-gray-700 hover:bg-gray-50">Annuller</Button>

// Lille handlingsknap i tabel
<Button size="sm" variant="outline" className="h-6 text-xs px-2.5">Åbn</Button>
```

---

## Filtre og søgning

```tsx
<div className="flex items-center gap-2">
  {/* Søgefelt */}
  <div className="relative">
    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
    <Input placeholder="Søg..." className="pl-8 h-8 text-sm w-60 border-gray-300" />
  </div>

  {/* Kategori-filter — brug Select, ikke inline tabs */}
  <Select value={filter} onValueChange={setFilter}>
    <SelectTrigger className="w-[160px] h-8 text-sm">
      <SelectValue placeholder="Alle kategorier" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="alle">Alle kategorier</SelectItem>
      <SelectItem value="dokumentar">Dokumentar</SelectItem>
    </SelectContent>
  </Select>
</div>
```

**Aldrig** inline tekst-tabs til filtrering (fx `Alle | Feature | TV-serie`). Brug `<Select>`.

---

## AI-banner (sidebar)

GDPR-kommunikation i bunden af sidebar. Neutral stil — ikke blå.

```tsx
<div className="mx-2 mb-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 space-y-1">
  <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
    <Info className="h-3.5 w-3.5 shrink-0 text-gray-400" />
    AI-assisteret system
  </div>
  <p className="text-[10px] text-gray-500 leading-relaxed">
    DFKS bruger AI til at screene kontrakter og behandle rettighedsbetalinger.
    Personfølsomme data anonymiseres inden behandling, og AI-tjenesten træner ikke på dine data.
  </p>
</div>
```

---

## Dialogs / modals

```tsx
<Dialog>
  <DialogContent className="max-w-lg">
    <DialogHeader>
      <DialogTitle>Titel</DialogTitle>
      <DialogDescription>Beskrivelse af hvad dialogen gør.</DialogDescription>
    </DialogHeader>
    {/* indhold */}
    <DialogFooter>
      <Button variant="outline" onClick={onClose}>Annuller</Button>
      <Button onClick={onSave}>Gem</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## Spacing og layout

- **Side-padding:** `p-6` i `<main>`.
- **Sektions-gap:** `space-y-6` eller `space-y-8` mellem hoved-sektioner.
- **Kort:** `rounded-lg border border-gray-200 bg-white`.
- **Separator:** brug `<Separator />` til at adskille større sektioner visuelt.

---

## Shadcn-komponenter i brug

Avatar · Badge · Breadcrumb · Button · Calendar · Card · Collapsible · Dialog ·
DropdownMenu · Input · Label · Popover · Progress · Select · Separator · Sheet ·
Sidebar · Skeleton · Sonner (toast) · Switch · Textarea

---

## Admin vs. Member-portal

Begge bruger det **samme** visuelle sprog. Den eneste forskel:

| | Admin | Member-portal |
|---|---|---|
| Layout | Sidebar + `PageHeader` komponent | Sidebar + inline H1/subtitle |
| Navigation | Rollebaserede menupunkter | Fast nav: Mine Værker, Mine Kontrakter, Økonomi, Min Profil |
| Datadybde | Fuld adgang, valideringsflow | Kun egne data |

---

*Sidst opdateret: juni 2026 · DFKS Kontraktportal*
