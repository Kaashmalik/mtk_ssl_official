# Secrets Rotation & Management Policy

## 1. Objective
Ensure all cryptographic keys, database credentials, API tokens, and service credentials are rotated regularly and managed securely to minimize the impact of any potential credential leak.

---

## 2. Rotation Schedules

| Credential Type | Rotation Frequency | Method | Owner |
|-----------------|--------------------|--------|-------|
| Database Passwords | Every 90 days | Automated via AWS Secrets Manager / GCP Secret Manager | Platform Team |
| Clerk API Keys | Every 180 days | Manual (Zero-downtime key rotation in dashboard) | Security Admin |
| Stripe/Payment Webhook Keys | Every 180 days | Manual rotation | Finance Tech |
| SSL / TLS Certificates | Every 60 days (automatic) | Let's Encrypt / ACME integration | SSL Service |
| SSH Keys (Production Nodes) | Every 90 days | Automated via Terraform & Ansible | DevOps Team |
| JWT Signing Keys | Every 30 days | Automated OIDC Discovery endpoint rotation | Auth Service |

---

## 3. Storage & Access Standards
1. **Zero Hardcoded Secrets**: Under no circumstances should secrets be checked into source control. All `.env` files must be ignored.
2. **Centralized Vault**: Google Cloud Secret Manager (for staging/production) and localized `.env.local` files (for local development) are the source of truth.
3. **IAM Least Privilege**: GCP Workload Identity binds Kubernetes service accounts directly to Google Secret Manager IAM roles, preventing the use of long-lived GCP service account JSON keys.

---

## 4. Emergency Rotation Procedure
In the event of a suspected leak/compromise:
1. Revoke the compromised token/credential immediately in the parent dashboard.
2. Provision a new secret in GCP Secret Manager.
3. Trigger a rolling restart of the affected microservices:
   ```bash
   kubectl rollout restart deployment/scoring-service -n ssl-scoring
   ```
4. Verify application health using the `/health/ready` check endpoint.
5. Review Sentry/Cloud Audit Logs to identify any unauthorized access during the compromise window.
