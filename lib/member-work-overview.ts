import type { Assignment } from "@/app/portal/mine-vaerker/MineVaerkerClient";

type AssignmentWork = NonNullable<Assignment["works"]>;

export type MemberOverviewItem =
  | {
      kind: "work";
      work: AssignmentWork & { assignment: Assignment };
      contractCount: number;
      pendingCount: number;
      unreadCount: number;
    }
  | {
      kind: "season";
      key: string;
      parentWorkId: string;
      seasonNumber: number;
      title: string;
      type: string;
      year: number | null;
      productionYear: number | null;
      posterUrl: string | null;
      episodeCount: number;
      workIds: string[];
      assignmentIds: string[];
      contractCount: number;
      pendingCount: number;
      unreadCount: number;
      roleSummary: string | null;
      createdAt: string | null;
      episodeSelectionStatus?: "pending" | "confirmed";
      episodeScopeId?: string | null;
      coversWholeSeason?: boolean;
    };

export function memberOverviewItemsToAssignments(items: MemberOverviewItem[]): Assignment[] {
  return items.map(item => {
    if (item.kind === "work") {
      return {
        ...item.work.assignment,
        works: item.work.assignment.works ? {
          ...item.work.assignment.works,
          overview_contract_count: item.contractCount,
          overview_pending_count: item.pendingCount,
          overview_unread_count: item.unreadCount,
        } : null,
      };
    }
    return {
      id: item.key,
      role: item.roleSummary,
      contract_id: null,
      episode_id: null,
      created_at: item.createdAt,
      episodes: null,
      works: {
        id: item.key,
        title: item.title,
        type: item.type,
        year: item.year,
        production_year: item.productionYear,
        duration_minutes: null,
        episode_count: item.episodeCount,
        parent_work_id: item.parentWorkId,
        season_number: item.seasonNumber,
        episode_number: null,
        genre: null,
        director: null,
        production_companies: null,
        status: item.pendingCount > 0 ? "til_godkendelse" : "aktiv",
        dfi_id: null,
        tmdb_id: null,
        poster_url: item.posterUrl,
        description: null,
        is_season_group: true,
        group_key: item.key,
        child_work_ids: item.workIds,
        child_assignment_ids: item.assignmentIds,
        overview_contract_count: item.contractCount,
        overview_pending_count: item.pendingCount,
        overview_unread_count: item.unreadCount,
        episode_selection_status: item.episodeSelectionStatus,
        episode_scope_id: item.episodeScopeId,
        covers_whole_season: item.coversWholeSeason,
      },
    };
  });
}
