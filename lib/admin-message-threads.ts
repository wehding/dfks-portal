export type AdminMessageSource = "direct" | "contract" | "work" | "review" | "screening";

export type AdminMessage = {
  id: string;
  author_user_id: string;
  author_role: "member" | "admin";
  body: string;
  created_at: string;
};

/**
 * Fælles, serverleveret trådformat til adminoverblikket og værkssidens
 * beskedpanel. Ulæst-status er bevidst adskilt fra både svarbehov og
 * behandling af den underliggende sag.
 */
export type AdminMessageThread = {
  id: string;
  source_type: AdminMessageSource;
  subject: string;
  context_title: string;
  category_label: string;
  updated_at: string;
  created_at: string;
  rettighedshavere: { full_name: string; email?: string | null } | null;
  member_messages: AdminMessage[];
  unreadCount: number;
  requiresReply: boolean;
  waitingSince: string | null;
  can_reply: boolean;
  action_href: string | null;
  workId?: string;
  requestId?: string;
};
