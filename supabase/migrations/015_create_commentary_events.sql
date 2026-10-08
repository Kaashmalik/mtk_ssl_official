-- Create commentary_events table
CREATE TABLE IF NOT EXISTS public.commentary_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  over_number INT NOT NULL,
  ball_number INT NOT NULL,
  language VARCHAR(10) NOT NULL DEFAULT 'en',
  tone VARCHAR(50) NOT NULL DEFAULT 'neutral',
  text TEXT NOT NULL,
  is_ai_generated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_commentary_events_match_id ON public.commentary_events(match_id);
CREATE INDEX IF NOT EXISTS idx_commentary_events_tenant_id ON public.commentary_events(tenant_id);

-- Enable RLS
ALTER TABLE public.commentary_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies using unified tenant isolation strategy
CREATE POLICY "super_admin_all_commentary_events" ON public.commentary_events
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE POLICY "tenant_isolation_commentary_events" ON public.commentary_events
  FOR SELECT USING (tenant_id = ANY(current_tenant_id()));

CREATE POLICY "tenant_admin_write_commentary_events" ON public.commentary_events
  FOR ALL USING (tenant_id = ANY(current_tenant_id())) WITH CHECK (tenant_id = ANY(current_tenant_id()));
