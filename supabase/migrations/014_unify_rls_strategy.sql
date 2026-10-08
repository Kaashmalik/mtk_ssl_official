-- ============================================================================
-- Migration 014: Unify RLS Tenant Isolation Strategy
-- ============================================================================
-- This migration standardizes the RLS tenant isolation policies by dropping
-- session-based policies (using current_setting('app.tenant_id') or 
-- current_setting('app.current_tenant')) and replacing them with policies
-- based on the secure current_tenant_id() JWT helper function.
--
-- It also adds missing policies for tables that had RLS enabled but no
-- policies defined.

-- ============================================================================
-- 1. DROP SESSION-BASED POLICIES
-- ============================================================================

-- Microservices tables (004)
DROP POLICY IF EXISTS tenant_isolation_standings ON public.tournament_standings;
DROP POLICY IF EXISTS tenant_isolation_ball_events ON public.ball_events;
DROP POLICY IF EXISTS tenant_isolation_scorecards ON public.live_scorecards;
DROP POLICY IF EXISTS tenant_isolation_payments ON public.payments;
DROP POLICY IF EXISTS user_notifications ON public.notifications;

-- Fantasy tables (009)
DROP POLICY IF EXISTS tenant_isolation_fantasy_leagues ON public.fantasy_leagues;
DROP POLICY IF EXISTS tenant_isolation_fantasy_teams ON public.fantasy_teams;
DROP POLICY IF EXISTS tenant_isolation_fantasy_players ON public.fantasy_team_players;

-- CQRS Event Store (010)
DROP POLICY IF EXISTS tenant_isolation_events ON public.scoring_events;

-- ============================================================================
-- 2. CREATE STANDARD TENANT-ISOLATION POLICIES (current_tenant_id())
-- ============================================================================

-- Tournament Standings
CREATE POLICY "super_admin_all_standings" ON public.tournament_standings FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_standings" ON public.tournament_standings FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Ball Events
CREATE POLICY "super_admin_all_ball_events" ON public.ball_events FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_ball_events" ON public.ball_events FOR SELECT USING (tenant_id = ANY(current_tenant_id()));
-- Allow authorized scorers to insert/update ball events
CREATE POLICY "scorer_manage_ball_events" ON public.ball_events 
  FOR ALL USING (tenant_id = ANY(current_tenant_id())) 
  WITH CHECK (tenant_id = ANY(current_tenant_id()));

-- Live Scorecards
CREATE POLICY "super_admin_all_scorecards" ON public.live_scorecards FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_scorecards" ON public.live_scorecards FOR SELECT USING (tenant_id = ANY(current_tenant_id()));
CREATE POLICY "scorer_manage_scorecards" ON public.live_scorecards 
  FOR ALL USING (tenant_id = ANY(current_tenant_id())) 
  WITH CHECK (tenant_id = ANY(current_tenant_id()));

-- Unified Payments
CREATE POLICY "tenant_isolation_payments" ON public.payments FOR SELECT USING (tenant_id = ANY(current_tenant_id()));
-- Allow inserting payments for their own tenant
CREATE POLICY "tenant_insert_payments" ON public.payments FOR INSERT WITH CHECK (tenant_id = ANY(current_tenant_id()));

-- Notifications
CREATE POLICY "super_admin_all_notifications" ON public.notifications FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_notifications" ON public.notifications 
  FOR SELECT USING (user_id = auth.uid() OR tenant_id = ANY(current_tenant_id()));

-- Player Statistics
CREATE POLICY "super_admin_all_player_stats" ON public.player_statistics FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_player_stats" ON public.player_statistics FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Notification Preferences
CREATE POLICY "super_admin_all_notif_pref" ON public.notification_preferences FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "user_manage_notif_pref" ON public.notification_preferences 
  FOR ALL USING (user_id = auth.uid() AND tenant_id = ANY(current_tenant_id()))
  WITH CHECK (user_id = auth.uid() AND tenant_id = ANY(current_tenant_id()));

-- Push Tokens
CREATE POLICY "super_admin_all_push_tokens" ON public.push_tokens FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "user_manage_push_tokens" ON public.push_tokens 
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- AI Commentary
CREATE POLICY "super_admin_all_commentary" ON public.ai_commentary FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_commentary" ON public.ai_commentary FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Audit Logs
CREATE POLICY "super_admin_all_audit_logs" ON public.audit_logs FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_audit_logs" ON public.audit_logs FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Fantasy Leagues
CREATE POLICY "super_admin_all_fantasy_leagues" ON public.fantasy_leagues FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_fantasy_leagues" ON public.fantasy_leagues FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Fantasy Teams
CREATE POLICY "super_admin_all_fantasy_teams" ON public.fantasy_teams FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_fantasy_teams" ON public.fantasy_teams FOR SELECT USING (tenant_id = ANY(current_tenant_id()));
CREATE POLICY "user_manage_fantasy_teams" ON public.fantasy_teams 
  FOR ALL USING (owner_id = auth.uid() AND tenant_id = ANY(current_tenant_id()))
  WITH CHECK (owner_id = auth.uid() AND tenant_id = ANY(current_tenant_id()));

-- Fantasy Team Players
CREATE POLICY "super_admin_all_fantasy_players" ON public.fantasy_team_players FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_fantasy_players" ON public.fantasy_team_players FOR SELECT USING (tenant_id = ANY(current_tenant_id()));
-- Allow users to manage players in their own fantasy teams
CREATE POLICY "user_manage_fantasy_players" ON public.fantasy_team_players
  FOR ALL USING (
    tenant_id = ANY(current_tenant_id()) AND 
    fantasy_team_id IN (SELECT id FROM public.fantasy_teams WHERE owner_id = auth.uid())
  )
  WITH CHECK (
    tenant_id = ANY(current_tenant_id()) AND 
    fantasy_team_id IN (SELECT id FROM public.fantasy_teams WHERE owner_id = auth.uid())
  );

-- CQRS Event Store (scoring_events)
CREATE POLICY "super_admin_all_events" ON public.scoring_events FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_isolation_events" ON public.scoring_events FOR SELECT USING (tenant_id = ANY(current_tenant_id()));
CREATE POLICY "scorer_insert_events" ON public.scoring_events FOR INSERT WITH CHECK (tenant_id = ANY(current_tenant_id()));
