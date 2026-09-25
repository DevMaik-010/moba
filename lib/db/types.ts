/**
 * Tipos del esquema, mantenidos a mano en paralelo a `supabase/migrations/`.
 * Si cambias una migración, actualiza también este archivo.
 */

export type AppRole = "admin" | "user";
export type TournamentMode = "1v1" | "3v3" | "5v5";
export type TournamentStatus =
  | "draft"
  | "open"
  | "locked"
  | "running"
  | "finished"
  | "cancelled";
export type TeamStatus = "draft" | "registered" | "rejected" | "eliminated";
export type MatchStatus = "pending" | "ready" | "live" | "done" | "bye";
export type ValidationStatus =
  | "pending"
  | "valid"
  | "invalid"
  | "manual_ok"
  | "manual_rejected";
export type MatchSide = "a" | "b";

/** Cuántos jugadores lleva cada modo. */
export const TEAM_SIZE_BY_MODE: Record<TournamentMode, number> = {
  "1v1": 1,
  "3v3": 3,
  "5v5": 5,
};

export const BRACKET_SIZES = [2, 4, 8, 16, 32, 64] as const;
export type BracketSize = (typeof BRACKET_SIZES)[number];

export type Profile = {
  id: string;
  role: AppRole;
  display_name: string;
  created_at: string;
};

export type Tournament = {
  id: string;
  name: string;
  slug: string;
  mode: TournamentMode;
  team_size: number;
  bracket_size: number;
  status: TournamentStatus;
  rules: string;
  starts_at: string | null;
  created_by: string;
  created_at: string;
  archived_at: string | null;
};

export type Team = {
  id: string;
  tournament_id: string;
  name: string;
  tag: string;
  captain_id: string;
  status: TeamStatus;
  seed: number | null;
  saved_team_id: string | null;
  created_at: string;
};

/** Equipo del usuario, reutilizable en cada torneo de su mismo modo. */
export type SavedTeam = {
  id: string;
  owner_id: string;
  name: string;
  tag: string;
  mode: TournamentMode;
  team_size: number;
  created_at: string;
  updated_at: string;
};

export type SavedTeamMember = {
  id: string;
  saved_team_id: string;
  slot: number;
  game_user_id: string;
  zone_id: string;
  nickname: string | null;
  validation_status: ValidationStatus;
  validated_at: string | null;
};

export type TeamMember = {
  id: string;
  team_id: string;
  tournament_id: string;
  slot: number;
  game_user_id: string;
  zone_id: string;
  nickname: string | null;
  is_captain: boolean;
  validation_status: ValidationStatus;
  validated_at: string | null;
};

export type Match = {
  id: string;
  tournament_id: string;
  round: number;
  slot: number;
  team_a_id: string | null;
  team_b_id: string | null;
  winner_id: string | null;
  score_a: number;
  score_b: number;
  status: MatchStatus;
  next_match_id: string | null;
  next_side: MatchSide | null;
  scheduled_at: string | null;
  updated_at: string;
};

export type MlbbLookupLogRow = {
  id: number;
  profile_id: string;
  game_user_id: string;
  zone_id: string;
  created_at: string;
};

export type MlbbAccountCacheRow = {
  game_user_id: string;
  zone_id: string;
  nickname: string | null;
  status: ValidationStatus;
  provider: string;
  raw: unknown;
  checked_at: string;
};

export type AuditLogRow = {
  id: number;
  actor_id: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  detail: unknown;
  created_at: string;
};

/**
 * `Relationships` es obligatorio para que postgrest-js reconozca el esquema;
 * sin él, el cliente tipado degrada cada tabla a `never`. Queda vacío porque no
 * usamos joins implícitos (`select("*, teams(*)")`) en ningún sitio.
 */
type Row<T> = {
  Row: T;
  Insert: Partial<T>;
  Update: Partial<T>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Row<Profile>;
      tournaments: Row<Tournament>;
      teams: Row<Team>;
      team_members: Row<TeamMember>;
      saved_teams: Row<SavedTeam>;
      saved_team_members: Row<SavedTeamMember>;
      matches: Row<Match>;
      mlbb_account_cache: Row<MlbbAccountCacheRow>;
      mlbb_lookup_log: Row<MlbbLookupLogRow>;
      audit_log: Row<AuditLogRow>;
    };
    Functions: {
      set_user_role: {
        Args: { p_profile_id: string; p_role: AppRole };
        Returns: undefined;
      };
      open_tournament: { Args: { p_tournament_id: string }; Returns: undefined };
      register_team: {
        Args: { p_team_id: string };
        Returns: {
          seed: number;
          match_id: string;
          match_slot: number;
          side: MatchSide;
        }[];
      };
      upsert_saved_team: {
        Args: {
          p_saved_team_id: string | null;
          p_name: string;
          p_tag: string;
          p_mode: TournamentMode;
          p_members: { slot: number; gameUserId: string; zoneId: string }[];
        };
        Returns: string;
      };
      register_saved_team: {
        Args: { p_saved_team_id: string; p_tournament_id: string };
        Returns: {
          seed: number;
          match_id: string;
          match_slot: number;
          side: MatchSide;
        }[];
      };
      set_tournament_archived: {
        Args: { p_tournament_id: string; p_archived: boolean };
        Returns: undefined;
      };
      lock_tournament: { Args: { p_tournament_id: string }; Returns: undefined };
      start_tournament: { Args: { p_tournament_id: string }; Returns: undefined };
      update_tournament: {
        Args: {
          p_tournament_id: string;
          p_name: string;
          p_rules: string;
          p_starts_at: string | null;
          p_mode: TournamentMode;
          p_bracket_size: number;
        };
        Returns: undefined;
      };
      cancel_tournament: { Args: { p_tournament_id: string }; Returns: undefined };
      delete_tournament: { Args: { p_tournament_id: string }; Returns: undefined };
      remove_team: { Args: { p_team_id: string }; Returns: undefined };
      report_match: {
        Args: { p_match_id: string; p_score_a: number; p_score_b: number };
        Returns: undefined;
      };
      resolve_member_validation: {
        Args: {
          p_member_id: string;
          p_status: ValidationStatus;
          p_nickname?: string | null;
        };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: AppRole;
      tournament_mode: TournamentMode;
      tournament_status: TournamentStatus;
      team_status: TeamStatus;
      match_status: MatchStatus;
      validation_status: ValidationStatus;
      match_side: MatchSide;
    };
    Views: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
