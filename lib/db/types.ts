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
  /** ID de MLBB de la cuenta; null en cuentas anteriores a 0010. */
  game_user_id: string | null;
  zone_id: string | null;
  mlbb_nickname: string | null;
  /** null = sin ID registrado. Solo valid/manual_ok permiten inscribirse. */
  mlbb_status: ValidationStatus | null;
  mlbb_checked_at: string | null;
  created_at: string;
};

export type MlbbSignupLookupLogRow = {
  id: number;
  ip: string;
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
  /** Ruta en el bucket `team-logos`, copiada del equipo guardado. */
  logo_path: string | null;
  created_at: string;
};

/** Código de inscripción del equipo: lo leen su capitán y el admin. */
export type TeamAccessCode = {
  team_id: string;
  tournament_id: string;
  code: string;
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
  logo_path: string | null;
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
  /** Lado cuyo capitán crea la sala en MLBB. Se sortea al quedar listo. */
  host_side: MatchSide | null;
  scheduled_at: string | null;
  updated_at: string;
};

/** Fila de `match_rooms`. Solo la lee el admin; el resto pasa por get_match_room.
 * `code_a` / `code_b` ya no dan acceso: manda el código de inscripción (0009). */
export type MatchRoom = {
  match_id: string;
  tournament_id: string;
  code_a: string;
  code_b: string;
  room_id: string | null;
  room_posted_at: string | null;
  claim_side: MatchSide | null;
  claim_score_a: number | null;
  claim_score_b: number | null;
  claimed_by: string | null;
  claimed_at: string | null;
  disputed_at: string | null;
  dispute_note: string | null;
  resolved_at: string | null;
  created_at: string;
};

/** Lo que devuelve get_match_room: `room` solo viene con código válido o siendo admin. */
export type MatchRoomView = {
  match: {
    id: string;
    round: number;
    slot: number;
    status: MatchStatus;
    score_a: number;
    score_b: number;
    winner_id: string | null;
    host_side: MatchSide | null;
  };
  tournament: {
    id: string;
    name: string;
    slug: string;
    status: TournamentStatus;
    mode: TournamentMode;
    rounds: number;
  };
  team_a: MatchRoomTeam | null;
  team_b: MatchRoomTeam | null;
  has_room: boolean;
  viewer: MatchSide | "admin" | null;
  /** Lado que capitanea el usuario con sesión, si juega este partido. */
  captain_side: MatchSide | null;
  room: {
    room_id: string | null;
    room_posted_at: string | null;
    claim_side: MatchSide | null;
    claim_score_a: number | null;
    claim_score_b: number | null;
    claimed_at: string | null;
    disputed_at: string | null;
    dispute_note: string | null;
    resolved_at: string | null;
    /** Códigos de inscripción de cada equipo; solo los ve el admin. */
    code_a: string | null;
    code_b: string | null;
  } | null;
};

type MatchRoomTeam = { id: string; name: string; tag: string; logo_path: string | null };

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
      team_access_codes: Row<TeamAccessCode>;
      saved_teams: Row<SavedTeam>;
      saved_team_members: Row<SavedTeamMember>;
      matches: Row<Match>;
      match_rooms: Row<MatchRoom>;
      mlbb_account_cache: Row<MlbbAccountCacheRow>;
      mlbb_lookup_log: Row<MlbbLookupLogRow>;
      mlbb_signup_lookup_log: Row<MlbbSignupLookupLogRow>;
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
      set_my_game_account: {
        Args: { p_game_user_id: string; p_zone_id: string };
        Returns: ValidationStatus;
      };
      resolve_profile_validation: {
        Args: {
          p_profile_id: string;
          p_status: ValidationStatus;
          p_nickname?: string | null;
        };
        Returns: undefined;
      };
      set_saved_team_logo: {
        Args: { p_saved_team_id: string; p_path: string | null };
        Returns: string | null;
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
      get_match_room: {
        Args: { p_match_id: string; p_code?: string | null };
        Returns: MatchRoomView | null;
      };
      post_match_room: {
        Args: { p_match_id: string; p_room_id: string };
        Returns: undefined;
      };
      claim_match_win: {
        Args: { p_match_id: string; p_my_score: number; p_rival_score: number };
        Returns: undefined;
      };
      dispute_match_claim: {
        Args: { p_match_id: string; p_note: string };
        Returns: undefined;
      };
      confirm_match_claim: { Args: { p_match_id: string }; Returns: undefined };
      reject_match_claim: { Args: { p_match_id: string }; Returns: undefined };
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
