type ContractMessageStatus = {
  author_role: "member" | "admin";
  member_read_at?: string | null;
};

export function unreadAdminMessageCount(comments: ContractMessageStatus[] | null | undefined) {
  return (comments ?? []).filter(comment => comment.author_role === "admin" && !comment.member_read_at).length;
}

export function hasLinkedWork(workId: string | null | undefined) {
  return Boolean(workId);
}

export function shouldShowWorkLinkBadge(hasLinkedWork: boolean, status: string) {
  return !(hasLinkedWork && status === "valideret");
}
