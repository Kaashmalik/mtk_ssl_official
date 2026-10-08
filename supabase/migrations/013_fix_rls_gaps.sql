-- ============================================================================
-- Migration 013: Enable RLS and Create Policies for Unprotected Tables
-- ============================================================================
-- This migration enables Row Level Security (RLS) on all remaining unprotected
-- tables (admin dashboard, white-label, fantasy, CQRS) and defines policies
-- for tenant data isolation and super-admin management.

-- ============================================================================
-- 1. ADMIN DASHBOARD TABLES
-- ============================================================================

-- Subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_subscriptions" ON public.subscriptions FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_read_subscriptions" ON public.subscriptions FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Payments (super admin override policy, tenant isolation is defined in 004/014)
CREATE POLICY "super_admin_all_payments" ON public.payments FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- Announcements
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_announcements" ON public.announcements FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "public_read_announcements" ON public.announcements FOR SELECT USING (is_active = true);

-- Feature Flags
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_feature_flags" ON public.feature_flags FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "public_read_feature_flags" ON public.feature_flags FOR SELECT USING (is_enabled = true);

-- System Health
ALTER TABLE public.system_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_system_health" ON public.system_health FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- Error Logs
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_error_logs" ON public.error_logs FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "anonymous_insert_error_logs" ON public.error_logs FOR INSERT WITH CHECK (true);

-- Commission Rates
ALTER TABLE public.commission_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_commission_rates" ON public.commission_rates FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "public_read_commission_rates" ON public.commission_rates FOR SELECT USING (is_active = true);

-- White-label Requests
ALTER TABLE public.white_label_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_white_label" ON public.white_label_requests FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_manage_white_label" ON public.white_label_requests FOR ALL USING (tenant_id = ANY(current_tenant_id())) WITH CHECK (tenant_id = ANY(current_tenant_id()));

-- ============================================================================
-- 2. WHITE-LABEL INFRASTRUCTURE TABLES
-- ============================================================================

-- DNS Verifications
ALTER TABLE public.dns_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_dns" ON public.dns_verifications FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_read_dns" ON public.dns_verifications FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- SSL Certificates
ALTER TABLE public.ssl_certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_ssl" ON public.ssl_certificates FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_read_ssl" ON public.ssl_certificates FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Email Domain Verifications
ALTER TABLE public.email_domain_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_email_domain" ON public.email_domain_verifications FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_read_email_domain" ON public.email_domain_verifications FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- ============================================================================
-- 3. FANTASY & CQRS TABLES
-- ============================================================================

-- Scorecard Projections
ALTER TABLE public.scorecard_projections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_projections" ON public.scorecard_projections FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_read_projections" ON public.scorecard_projections FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

-- Fantasy Points Rules
ALTER TABLE public.fantasy_points_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_all_fantasy_rules" ON public.fantasy_points_rules FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "public_read_fantasy_rules" ON public.fantasy_points_rules FOR SELECT USING (true);

-- Fantasy Match Points (RLS enabled in 009, policy added here)
CREATE POLICY "super_admin_all_fantasy_match_points" ON public.fantasy_match_points FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "tenant_read_fantasy_match_points" ON public.fantasy_match_points FOR SELECT USING (tenant_id = ANY(current_tenant_id()));
