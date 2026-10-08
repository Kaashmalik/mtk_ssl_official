import { Counter, Registry, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();

registry.setDefaultLabels({
  app: "ssl-api",
});

collectDefaultMetrics({ register: registry });

// Define custom counter for quota violations
export const tenantQuotaViolationsCounter = new Counter({
  name: "ssl_tenant_quota_violations_total",
  help: "Total number of request quota violations by tenant",
  labelNames: ["tenant"],
  registers: [registry],
});
