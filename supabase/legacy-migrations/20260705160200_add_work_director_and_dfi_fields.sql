alter table works
    add column if not exists director text,
    add column if not exists dfi_title text,
    add column if not exists dfi_danish_title text,
    add column if not exists dfi_original_title text,
    add column if not exists dfi_category text,
    add column if not exists dfi_type text;

comment on column works.director is
    'Instruktør/navn(e) for værket. Kan komme fra DFI PersonCredits eller indtastes manuelt.';

comment on column works.dfi_title is
    'DFI Title fra /v1/film/{id}. Separat fra works.title, som er portalens primære titel.';

comment on column works.dfi_danish_title is
    'DFI DanishTitle fra /v1/film/{id}.';

comment on column works.dfi_original_title is
    'DFI OriginalTitle fra /v1/film/{id}. Vises i UI som Original / work Title.';

comment on column works.dfi_category is
    'DFI Category fra /v1/film/{id}. Separat fra portalens normaliserede værktype.';

comment on column works.dfi_type is
    'DFI Type fra /v1/film/{id}. Separat fra portalens normaliserede værktype.';
