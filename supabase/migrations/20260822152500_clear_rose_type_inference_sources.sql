-- Midlertidig, målrettet testtilstand: Rose må hverken have en gemt
-- værktype eller en Simply-kategori, som UI'et kan udlede typen fra.
update public.screening_source_rows
set vaerk_type = null,
    category = null
where id = 'a14965b4-4a87-4ae5-aa25-a39da7dc6769'
  and title = 'Rose';
