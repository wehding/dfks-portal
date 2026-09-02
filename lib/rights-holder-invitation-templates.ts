export const MEMBER_WORK_INVITE_SUBJECT = "Gennemgå dine værker hos {organisation}";
export const MEMBER_WORK_INVITE_TEXT = `Kære {navn}

{organisation} arbejder for filmklipperes rettigheder og fordeler rettighedsmidler til klippere i Danmark.

Som medlem inviteres du til at gennemgå de produktioner, vi har registreret med krediteringer, der muligvis vedrører dig:

{værker}

Opret eller åbn din adgang til portalen, og kontrollér værker, afsnit, eventuelle medklippere og arbejdsandele.

For at kunne få del i rettighedspengene for værkerne skal du uploade dine kontrakter for de relevante produktioner i portalen. Kontrakterne bruges som dokumentation for dit arbejde og dine rettigheder.

Hvis en oplysning ikke er korrekt, kan du afvise eller rette den i portalen.

Med venlig hilsen
{organisation}`;

export const NON_MEMBER_WORK_INVITE_SUBJECT = "Du kan være registreret som klipper på {værk}";
export const NON_MEMBER_WORK_INVITE_TEXT = `Kære {navn}

{organisation} arbejder for filmklipperes rettigheder og fordeler rettighedsmidler til klippere i Danmark.

Vi er blevet opmærksomme på, at du muligvis har arbejdet som klipper på en eller flere af følgende produktioner:

{værker}

Du behøver ikke være medlem for at gennemgå oplysningerne. Opret adgang til portalen, og bekræft eller afvis værkerne samt eventuelle afsnit, medklippere og arbejdsandele.

For at kunne få del i rettighedspengene for værkerne skal du uploade dine kontrakter for de relevante produktioner i portalen. Kontrakterne bruges som dokumentation for dit arbejde og dine rettigheder.

Hvis oplysningerne ikke er korrekte, kan du afvise tilknytningen i portalen eller kontakte os.

Med venlig hilsen
{organisation}`;

export const WORK_INVITE_PLACEHOLDERS = ["{navn}", "{værk}", "{værker}", "{organisation}", "{invitationslink}"] as const;

export function validateWorkInvitationTemplate(subject: string, body: string) {
  if (/[\r\n]/.test(subject)) throw new Error("Emnet må kun fylde én linje.");
  const unknown = [...`${subject}\n${body}`.matchAll(/\{[^}]+\}/g)]
    .map(match => match[0])
    .filter(value => !WORK_INVITE_PLACEHOLDERS.includes(value as typeof WORK_INVITE_PLACEHOLDERS[number]));
  if (unknown.length) throw new Error(`Ukendt pladsholder: ${unknown[0]}`);
  if (!subject.trim() || !body.trim()) throw new Error("Emne og invitationstekst skal udfyldes.");
}
