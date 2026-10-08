/**
 * Deep column-level diff: Drizzle schema vs live DB.
 * Reports columns that exist in Drizzle but not in the live DB (and vice versa).
 */
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

// Drizzle schema columns (extracted from packages/database/src/schema/*.ts)
const drizzleColumns = {
  announcements: ["id", "title", "message", "type", "priority", "is_active", "target_audience", "start_date", "end_date", "action_url", "action_text", "created_by", "created_at", "updated_at"],
  audit_logs: ["id", "request_id", "tenant_id", "actor_id", "actor_role", "method", "path", "ip", "user_agent", "payload", "status_code", "created_at"],
  commentary_events: ["id", "tenant_id", "match_id", "over_number", "ball_number", "language", "tone", "text", "is_ai_generated", "created_at", "updated_at"],
  commission_rates: ["id", "plan", "rate", "description", "is_active", "updated_by", "created_at", "updated_at"],
  dns_verifications: ["id", "tenant_id", "domain", "verification_token", "verification_type", "expected_value", "status", "verified_at", "expires_at", "last_checked_at", "created_at", "updated_at"],
  documents: ["id", "tenant_id", "name", "file_url", "file_type", "file_size", "category", "uploaded_by", "is_public", "created_at", "updated_at"],
  email_domain_verifications: ["id", "tenant_id", "domain", "sender_email", "dkim_public_key", "dkim_private_key", "dkim_selector", "spf_record", "dmarc_record", "status", "verified_at", "expires_at", "last_checked_at", "verification_errors", "created_at", "updated_at"],
  fan_follows: ["id", "tenant_id", "user_id", "followable_type", "followable_id", "created_at"],
  fantasy_leagues: ["id", "tenant_id", "tournament_id", "name", "description", "max_teams", "entry_fee", "prize_pool", "status", "draft_deadline", "created_at", "updated_at"],
  fantasy_teams: ["id", "tenant_id", "league_id", "owner_id", "team_name", "total_points", "rank", "budget_remaining", "is_paid", "created_at"],
  fantasy_team_players: ["id", "tenant_id", "fantasy_team_id", "player_id", "role", "is_captain", "is_vice_captain", "cost", "total_points", "created_at"],
  fantasy_points_rules: ["id", "tenant_id", "event", "points", "multiplier", "description", "created_at"],
  fantasy_match_points: ["id", "tenant_id", "match_id", "fantasy_team_id", "player_id", "points", "breakdown", "created_at"],
  feature_flags: ["id", "key", "name", "description", "is_enabled", "rollout_percentage", "target_tenants", "metadata", "created_by", "created_at", "updated_at"],
  impersonation_sessions: ["id", "jti", "admin_user_id", "admin_email", "target_user_id", "target_email", "status", "issued_at", "consumed_at", "revoked_at", "expires_at", "issued_from_ip", "user_agent", "reason"],
  league_registrations: ["id", "tenant_id", "tournament_id", "team_id", "status", "registered_by", "approved_by", "rejection_reason", "registration_fee", "payment_status", "payment_transaction_id", "squad_player_ids", "notes", "approved_at", "created_at", "updated_at"],
  match_balls: ["id", "tenant_id", "match_id", "innings_id", "over_number", "ball_number", "bowler_id", "batsman_id", "runs", "is_wicket", "wicket_type", "is_four", "is_six", "is_wide", "is_no_ball", "is_bye", "is_leg_bye", "shot_direction", "shot_type", "created_at"],
  match_innings: ["id", "tenant_id", "match_id", "team_id", "innings_number", "total_runs", "total_wickets", "total_balls", "extras", "byes", "leg_byes", "wides", "no_balls", "status", "created_at", "updated_at"],
  matches: ["id", "tenant_id", "tournament_id", "team_a_id", "team_b_id", "venue_id", "match_number", "scheduled_date", "start_date", "end_date", "match_format", "match_type", "total_overs", "status", "toss_winner_id", "toss_decision", "winner_id", "result", "man_of_match_id", "umpire_1", "umpire_2", "third_umpire", "match_referee", "created_by", "created_at", "updated_at"],
  media: ["id", "tenant_id", "name", "file_url", "file_type", "mime_type", "file_size", "width", "height", "duration", "thumbnail_url", "category", "related_match_id", "related_team_id", "related_player_id", "uploaded_by", "is_public", "created_at", "updated_at"],
  player_ids: ["id", "tenant_id", "player_id", "prefix", "year", "sequence_number", "formatted_id", "issue_date", "expiry_date", "is_valid", "created_at"],
  player_season_stats: ["id", "tenant_id", "player_id", "tournament_id", "matches_played", "runs_scored", "balls_faced", "innings_batted", "not_outs", "fours", "sixes", "highest_score", "is_highest_score_not_out", "fifties", "hundreds", "ducks", "batting_average", "strike_rate", "wickets_taken", "overs_bowled", "balls_bowled", "runs_conceded", "innings_bowled", "maidens", "bowling_average", "economy_rate", "bowling_strike_rate", "best_bowling_wickets", "best_bowling_runs", "four_wicket_hauls", "five_wicket_hauls", "catches", "run_outs", "stumpings", "last_updated_match_id", "created_at", "updated_at"],
  players: ["id", "tenant_id", "team_id", "user_id", "profile_id", "name", "photo_url", "date_of_birth", "phone", "email", "nationality", "city", "height_cm", "weight_kg", "jersey_number", "role", "batting_style", "bowling_style", "biography", "status", "is_active", "joined_at", "created_by", "created_at", "updated_at"],
  profiles: ["id", "user_id", "tenant_id", "first_name", "last_name", "display_name", "avatar_url", "phone", "bio", "date_of_birth", "nationality", "city", "state", "country", "created_at", "updated_at"],
  scorecard_projections: ["id", "tenant_id", "match_id", "innings_id", "innings_number", "team_id", "total_runs", "total_wickets", "total_balls", "total_extras", "wides", "no_balls", "byes", "leg_byes", "current_over", "current_ball", "last_event_sequence", "updated_at"],
  batting_scorecards: ["id", "tenant_id", "match_id", "innings_id", "team_id", "player_id", "batting_position", "runs", "balls_faced", "fours", "sixes", "strike_rate", "dismissal_type", "bowler_id", "fielder_id", "dismissal_text", "minutes_batted", "dot_balls", "created_at"],
  bowling_scorecards: ["id", "tenant_id", "match_id", "innings_id", "team_id", "player_id", "bowling_position", "overs", "balls_bowled", "maidens", "runs_conceded", "wickets", "economy_rate", "dot_balls", "wides", "no_balls", "fours_conceded", "sixes_conceded", "created_at"],
  fielding_scorecards: ["id", "tenant_id", "match_id", "team_id", "player_id", "catches", "run_outs", "stumpings", "direct_hits", "dropped_catches", "created_at"],
  scoring_events: ["id", "tenant_id", "match_id", "innings_id", "event_type", "event_version", "aggregate_id", "sequence_number", "payload", "metadata", "created_at"],
  ssl_certificates: ["id", "tenant_id", "domain", "certificate_url", "private_key_url", "issuer", "status", "issued_at", "expires_at", "auto_renew", "last_renewed_at", "renewal_attempts", "error_message", "created_at", "updated_at"],
  subscriptions: ["id", "tenant_id", "plan", "status", "monthly_amount", "currency", "payment_method", "current_period_start", "current_period_end", "cancel_at_period_end", "canceled_at", "trial_ends_at", "created_at", "updated_at"],
  payments: ["id", "subscription_id", "tenant_id", "amount", "currency", "payment_method", "status", "transaction_id", "external_payment_id", "commission_amount", "paid_at", "created_at", "updated_at"],
  system_health: ["id", "service", "status", "response_time", "uptime", "cpu_usage", "memory_usage", "active_connections", "error_rate", "last_checked", "created_at"],
  error_logs: ["id", "service", "severity", "error_type", "message", "stack_trace", "user_id", "tenant_id", "metadata", "is_resolved", "resolved_at", "resolved_by", "created_at"],
  teams: ["id", "tenant_id", "tournament_id", "name", "short_name", "slug", "description", "city", "logo_url", "banner_url", "primary_color", "secondary_color", "captain_id", "manager_id", "jersey_color", "home_ground", "founded_year", "max_squad_size", "is_active", "created_by", "created_at", "updated_at"],
  tenant_branding: ["tenant_id", "logo_url", "favicon_url", "primary_color", "secondary_color", "accent_color", "font_family", "app_name", "hide_ssl_branding", "custom_css", "email_sender_name", "email_sender_address", "login_page_background_url", "login_page_custom_html", "mobile_app_icon_url", "mobile_app_splash_url", "mobile_app_bundle_id", "mobile_app_package_name", "separate_database", "database_instance_url", "created_at", "updated_at"],
  tenants: ["id", "name", "slug", "custom_domain", "custom_domain_verified", "custom_domain_verified_at", "ssl_enabled", "email_domain_verified", "owner_id", "plan", "is_active", "created_at", "updated_at"],
  tournaments: ["id", "tenant_id", "name", "slug", "description", "format", "start_date", "end_date", "registration_open", "registration_start", "registration_end", "registration_deadline", "max_teams", "entry_fee", "prize_pool", "rules", "sponsors", "live_stream_url", "is_featured", "status", "created_by", "created_at", "updated_at"],
  users: ["id", "clerk_id", "email", "display_name", "avatar_url", "tenant_ids", "role", "is_active", "last_login_at", "created_at", "updated_at"],
  venues: ["id", "tenant_id", "name", "address", "city", "state", "country", "capacity", "ground_type", "is_active", "created_at", "updated_at"],
  waitlist: ["id", "email", "name", "created_at", "updated_at"],
  white_label_requests: ["id", "tenant_id", "requested_by", "status", "custom_domain", "hide_branding", "custom_app_name", "reason", "admin_notes", "reviewed_by", "reviewed_at", "created_at", "updated_at"]
};

(async () => {
  try {
    const rows = await sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `;
    const liveColumns = {};
    rows.forEach(r => {
      if (!liveColumns[r.table_name]) liveColumns[r.table_name] = [];
      liveColumns[r.table_name].push(r.column_name);
    });

    let issues = 0;
    const drizzleTables = Object.keys(drizzleColumns);

    console.log('=== DRIZZLE ↔ LIVE DB COLUMN DIFF ===\n');

    for (const table of drizzleTables) {
      const dCols = drizzleColumns[table];
      const lCols = liveColumns[table] || [];

      const missingInLive = dCols.filter(c => !lCols.includes(c));
      const extraInLive = lCols.filter(c => !dCols.includes(c));

      if (missingInLive.length === 0 && extraInLive.length === 0) {
        console.log(`✅ ${table} (${dCols.length} cols) — in sync`);
      } else {
        issues++;
        console.log(`⚠️  ${table}:`);
        if (missingInLive.length > 0) {
          console.log(`   MISSING in live DB: ${missingInLive.join(', ')}`);
        }
        if (extraInLive.length > 0) {
          console.log(`   EXTRA in live DB (not in Drizzle): ${extraInLive.join(', ')}`);
        }
      }
    }

    // Tables in live DB not in Drizzle schema
    const liveOnly = Object.keys(liveColumns).filter(t => !drizzleTables.includes(t));
    if (liveOnly.length > 0) {
      console.log('\n=== TABLES IN LIVE DB BUT NOT IN DRIZZLE ===');
      liveOnly.forEach(t => console.log(`   📦 ${t} (${liveColumns[t].length} cols) — migration-only table`));
    }

    const drizzleOnly = drizzleTables.filter(t => !Object.keys(liveColumns).includes(t));
    if (drizzleOnly.length > 0) {
      console.log('\n=== TABLES IN DRIZZLE BUT NOT IN LIVE DB ===');
      drizzleOnly.forEach(t => console.log(`   ❌ ${t}`));
      issues += drizzleOnly.length;
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Drizzle tables: ${drizzleTables.length}`);
    console.log(`Live tables: ${Object.keys(liveColumns).length}`);
    console.log(`Issues found: ${issues}`);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await sql.end();
  }
})();
