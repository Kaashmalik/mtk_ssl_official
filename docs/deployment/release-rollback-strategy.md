# Production Release Pipeline & Rollback Strategy

## 1. Release Flow & Versioning
We use **Semantic Versioning** (`MAJOR.MINOR.PATCH`) to tag releases:
- `PATCH`: bug fixes.
- `MINOR`: backward-compatible new features.
- `MAJOR`: backward-incompatible changes (breaking APIs).

Releases are triggered automatically when a PR is merged into `main` branch.

---

## 2. Deployment Pipeline Stages (GitOps)
We use a GitOps methodology with **ArgoCD**:
1. **Docker Build & Push**: CI workflow builds production Docker images and pushes to GCR using Git commit SHA as tags (`gcr.io/project-id/scoring-service:sha-123abc`).
2. **Kubernetes Overlay Update**: The CI updates the staging/production Kustomize overlay `images` tag inside `infrastructure/kubernetes/overlays/production/kustomization.yaml`.
3. **Commit Config Change**: CI commits and pushes config changes back to the repositories.
4. **ArgoCD Sync**: ArgoCD detects the change, triggers sync, and runs a rolling update:
   ```yaml
   strategy:
     type: RollingUpdate
     rollingUpdate:
       maxSurge: 25%
       maxUnavailable: 25%
   ```

---

## 3. Database Migration Deployment
Database migrations are run as part of a Kubernetes `Job` pre-deploy hook:
1. Migration jobs run `pnpm db:migrate` targeting Cloud SQL.
2. If the migration fails, the deployment is aborted before the new pods are rolled out.
3. **Important Rules**: Migrations must be backward-compatible (e.g. adding columns instead of renaming, or using multi-phase deployments for breaking changes) so old pods can run alongside the migration.

---

## 4. Rollback Strategies

### Strategy A: Git Reversion (Preferred)
To rollback to a previous version, revert the deployment commit in the Git repository:
```bash
git revert <deployment-commit-sha>
git push origin main
```
ArgoCD will automatically sync and rollback the K8s cluster to the previous Docker image state.

### Strategy B: Instant Manual Rollback (Kubectl)
If the Git repository is inaccessible or GitOps is delayed during a critical outage:
```bash
# 1. Rollback the deployment in Kubernetes
kubectl rollout undo deployment/ssl-scoring-service -n ssl-scoring

# 2. Verify status
kubectl rollout status deployment/ssl-scoring-service -n ssl-scoring
```

### Strategy C: Database Rollback (Warning)
Database schema migrations cannot be automatically undone. In case of database-related bugs:
1. Revert app logic to support the migrated schema.
2. In extreme cases, restore PostgreSQL database from the automatic daily 02:00 Cloud SQL Backup / Point-in-time recovery (PITR) in GCP console.
