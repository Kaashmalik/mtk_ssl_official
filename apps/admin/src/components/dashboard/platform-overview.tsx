'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  Users, Building2, Trophy, Activity, DollarSign, 
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle,
  RefreshCw, Calendar, BarChart3, Shield, Settings
} from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, LineChart, Line, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface PlatformMetrics {
  tenants: {
    total: number;
    active: number;
    pending: number;
    suspended: number;
    growth: number;
  };
  users: {
    total: number;
    active: number;
    newThisMonth: number;
    growth: number;
  };
  matches: {
    total: number;
    live: number;
    completedToday: number;
    scheduledUpcoming: number;
  };
  revenue: {
    mrr: number;
    arr: number;
    growth: number;
    currency: string;
  };
  system: {
    uptime: number;
    apiLatency: number;
    errorRate: number;
    activeIncidents: number;
  };
  trends: {
    date: string;
    tenants: number;
    users: number;
    matches: number;
    revenue: number;
  }[];
}

export function PlatformOverviewDashboard() {
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/platform-metrics?range=${timeRange}`);
      if (!response.ok) {
        throw new Error('Failed to fetch platform metrics');
      }

      const data = await response.json();
      setMetrics(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [timeRange]);

  if (loading && !metrics) {
    return <DashboardSkeleton />;
  }

  if (error && !metrics) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error loading dashboard</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
        <Button onClick={fetchMetrics} variant="outline" className="mt-4">
          <RefreshCw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </Alert>
    );
  }

  if (!metrics) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Platform Overview</h1>
          <p className="text-muted-foreground mt-1">
            Monitor your platform's health and performance
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-sm text-muted-foreground">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button onClick={fetchMetrics} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* System Health Alert */}
      {metrics.system.activeIncidents > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Active Incidents</AlertTitle>
          <AlertDescription>
            {metrics.system.activeIncidents} active incident(s) require attention.
            <Button variant="link" className="ml-2 p-0 h-auto" asChild>
              <a href="/system-health">View details →</a>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Key Metrics Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Active Leagues"
          value={metrics.tenants.active.toLocaleString()}
          change={metrics.tenants.growth}
          icon={<Building2 className="h-5 w-5" />}
          description={`${metrics.tenants.pending} pending approval`}
          href="/tenants"
        />
        <MetricCard
          title="Active Users"
          value={metrics.users.active.toLocaleString()}
          change={metrics.users.growth}
          icon={<Users className="h-5 w-5" />}
          description={`${metrics.users.newThisMonth} new this month`}
          href="/users"
        />
        <MetricCard
          title="Live Matches"
          value={metrics.matches.live.toLocaleString()}
          icon={<Activity className="h-5 w-5" />}
          description={`${metrics.matches.completedToday} completed today`}
          href="/matches"
          highlight={metrics.matches.live > 0}
        />
        <MetricCard
          title="Monthly Revenue"
          value={new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: metrics.revenue.currency,
            maximumFractionDigits: 0
          }).format(metrics.revenue.mrr)}
          change={metrics.revenue.growth}
          icon={<DollarSign className="h-5 w-5" />}
          description="Monthly recurring revenue"
          href="/subscriptions"
        />
      </div>

      {/* Trends and Analytics */}
      <Tabs defaultValue="growth" className="space-y-4">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="growth">Growth Trends</TabsTrigger>
            <TabsTrigger value="activity">Match Activity</TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
          </TabsList>
          <div className="flex gap-2">
            {(['7d', '30d', '90d'] as const).map(range => (
              <Button
                key={range}
                variant={timeRange === range ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTimeRange(range)}
              >
                {range}
              </Button>
            ))}
          </div>
        </div>

        <TabsContent value="growth">
          <Card>
            <CardHeader>
              <CardTitle>Platform Growth</CardTitle>
              <CardDescription>League and user growth over time</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <AreaChart data={metrics.trends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="tenants" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} name="Leagues" />
                  <Area type="monotone" dataKey="users" stroke="#10b981" fill="#10b981" fillOpacity={0.2} name="Users" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Match Activity</CardTitle>
              <CardDescription>Matches played over time</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={metrics.trends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="matches" fill="#8b5cf6" name="Matches" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="revenue">
          <Card>
            <CardHeader>
              <CardTitle>Revenue Trends</CardTitle>
              <CardDescription>Monthly recurring revenue growth</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={metrics.trends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip formatter={(value) => `$${value}`} />
                  <Line type="monotone" dataKey="revenue" stroke="#f59e0b" strokeWidth={2} name="Revenue" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* System Health & Quick Actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" /> System Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <HealthMetric label="Uptime" value={`${metrics.system.uptime}%`} status={metrics.system.uptime >= 99.9 ? 'good' : 'warning'} />
            <HealthMetric label="API Latency" value={`${metrics.system.apiLatency}ms`} status={metrics.system.apiLatency < 200 ? 'good' : 'warning'} />
            <HealthMetric label="Error Rate" value={`${metrics.system.errorRate}%`} status={metrics.system.errorRate < 1 ? 'good' : 'warning'} />
            <Button variant="outline" className="w-full" asChild>
              <a href="/system-health">View System Health →</a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common administrative tasks</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Button variant="outline" className="justify-start" asChild>
              <a href="/league-applications"><Building2 className="mr-2 h-4 w-4" /> Review League Applications</a>
            </Button>
            <Button variant="outline" className="justify-start" asChild>
              <a href="/users"><Users className="mr-2 h-4 w-4" /> Manage Users</a>
            </Button>
            <Button variant="outline" className="justify-start" asChild>
              <a href="/audit-logs"><Shield className="mr-2 h-4 w-4" /> View Audit Logs</a>
            </Button>
            <Button variant="outline" className="justify-start" asChild>
              <a href="/feature-flags"><Settings className="mr-2 h-4 w-4" /> Feature Flags</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ title, value, change, icon, description, href, highlight }: {
  title: string;
  value: string;
  change?: number;
  icon: React.ReactNode;
  description: string;
  href: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-green-500' : ''}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <div className="flex items-center gap-2 mt-1">
          {change !== undefined && (
            <Badge variant={change >= 0 ? 'default' : 'destructive'} className="text-xs">
              {change >= 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
              {Math.abs(change)}%
            </Badge>
          )}
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button variant="link" className="p-0 h-auto mt-3 text-xs" asChild>
          <a href={href}>View details →</a>
        </Button>
      </CardContent>
    </Card>
  );
}

function HealthMetric({ label, value, status }: { label: string; value: string; status: 'good' | 'warning' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {status === 'good' ? 
          <CheckCircle className="h-4 w-4 text-green-500" /> : 
          <AlertTriangle className="h-4 w-4 text-yellow-500" />
        }
        <span className="font-medium">{value}</span>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-64 bg-muted rounded" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-muted rounded" />)}
      </div>
      <div className="h-96 bg-muted rounded" />
    </div>
  );
}
