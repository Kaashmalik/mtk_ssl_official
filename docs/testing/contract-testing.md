# Microservices Contract Testing Guide (Pact)

## 1. Introduction
Contract testing ensures that microservices communicating via gRPC or HTTP agree on message schemas without requiring deployment of the entire network. We use **Pact** for consumer-driven contract testing.

---

## 2. Testing Flow
1. **Consumer (e.g. API Gateway)** defines expectations (requests and expected responses) in a Pact test.
2. Running the consumer test generates a **Pact file** (JSON contract).
3. The Pact file is published to the **Pact Broker**.
4. **Provider (e.g. Scoring Service)** pulls the Pact contract from the broker and runs verification tests against its running codebase.

---

## 3. Installation
To install the required Pact dependencies in the workspace/service:
```bash
pnpm add -D @pact-foundation/pact
```

---

## 4. Execution Commands
To run contract verification on the provider side:
```bash
# In services/scoring-service
pnpm exec pact-verifier --provider-base-url=http://localhost:4000 --pact-urls=../../tests/contract/pacts/gateway-scoring.json
```
