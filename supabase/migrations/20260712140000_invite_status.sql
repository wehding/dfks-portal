-- Invitationsstatus på rettighedshavere.
-- I dag sættes user_id straks når invite-linket laves, så man kan ikke skelne
-- "inviteret men ikke registreret" fra "har oprettet sig". Vi tilføjer et
-- tidsstempel for hvornår invitationen sidst blev sendt.
--
-- Status udledes: ingen invite_sent_at + ingen login = "ikke inviteret";
-- invite_sent_at sat + onboarding ikke gennemført = "afventer";
-- onboarding_completed = "registreret".

alter table rettighedshavere
    add column if not exists invite_sent_at timestamptz;

comment on column rettighedshavere.invite_sent_at is
    'Hvornår invitationsmailen sidst blev sendt. Bruges til at udlede afventer-status.';

create index if not exists rettighedshavere_invite_sent_idx
    on rettighedshavere (invite_sent_at);
