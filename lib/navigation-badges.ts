export type NavigationBadgeCounts = {
  adminContracts: number;
  adminContractMessages: number;
  adminWorks: number;
  adminWorkMessages: number;
  adminWorkShareTasks: number;
  adminReviews: number;
  adminScreenings: number;
  memberWorkMessages: number;
  memberWorkReviewTodos: number;
  memberContractMessages: number;
  memberInboxMessages: number;
};

export const EMPTY_NAVIGATION_BADGES: NavigationBadgeCounts = {
  adminContracts: 0,
  adminContractMessages: 0,
  adminWorks: 0,
  adminWorkMessages: 0,
  adminWorkShareTasks: 0,
  adminReviews: 0,
  adminScreenings: 0,
  memberWorkMessages: 0,
  memberWorkReviewTodos: 0,
  memberContractMessages: 0,
  memberInboxMessages: 0,
};

export function normalizeNavigationBadgeCounts(row: Record<string, unknown> | null | undefined): NavigationBadgeCounts {
  const count = (key: string) => Math.max(0, Number(row?.[key] ?? 0) || 0);
  return {
    adminContracts: count("admin_contracts"),
    adminContractMessages: count("admin_contract_messages"),
    adminWorks: count("admin_works"),
    adminWorkMessages: count("admin_work_messages"),
    adminWorkShareTasks: count("admin_work_share_tasks"),
    adminReviews: count("admin_reviews"),
    adminScreenings: count("admin_screenings"),
    memberWorkMessages: count("member_work_messages"),
    memberWorkReviewTodos: count("member_work_review_todos"),
    memberContractMessages: count("member_contract_messages"),
    memberInboxMessages: count("member_inbox_messages"),
  };
}
