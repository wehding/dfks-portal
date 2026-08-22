-- Rose skal igen afprøve den almindelige typeudledning fra Simply-kategorien
-- (Movies -> spillefilm) i stedet for at afhænge af en allerede gemt værktype.
update public.screening_source_rows
set vaerk_type = null
where id = 'a14965b4-4a87-4ae5-aa25-a39da7dc6769'
  and title = 'Rose';
