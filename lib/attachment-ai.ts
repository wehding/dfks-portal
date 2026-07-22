export type AttachmentComparableFields = {
  startDate: unknown;
  endDate: unknown;
  salary: unknown;
  salaryUnit: unknown;
  workingWeeks: unknown;
  rightsOverview: unknown;
};

export function comparableAttachmentFields(value: Record<string, unknown>): AttachmentComparableFields {
  return {
    startDate: value.startDate ?? null,
    endDate: value.endDate ?? null,
    salary: value.salary ?? null,
    salaryUnit: value.salaryUnit ?? null,
    workingWeeks: value.workingWeeks ?? null,
    rightsOverview: value.rightsOverview ?? null,
  };
}

export function attachmentChanges(parentValue: Record<string, unknown>, attachmentValue: Record<string, unknown>) {
  const parent = comparableAttachmentFields(parentValue);
  const extracted = comparableAttachmentFields(attachmentValue);
  const changes = (Object.keys(extracted) as Array<keyof AttachmentComparableFields>)
    .filter(key => JSON.stringify(extracted[key]) !== JSON.stringify(parent[key]))
    .map(key => ({ field: key, before: parent[key], after: extracted[key] }));
  return { extracted, changes };
}
