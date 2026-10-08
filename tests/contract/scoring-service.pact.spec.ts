import { Pact } from "@pact-foundation/pact";
import path from "path";
import fetch from "node-fetch";

// Pact template testing contract between API Gateway (Consumer) and Scoring Service (Provider)
describe("Scoring Service API Contract", () => {
  const provider = new Pact({
    consumer: "ApiGateway",
    provider: "ScoringService",
    port: 1234,
    log: path.resolve(process.cwd(), "logs", "pact.log"),
    dir: path.resolve(process.cwd(), "tests/contract/pacts"),
    logLevel: "info",
  });

  beforeAll(() => provider.setup());
  afterAll(() => provider.finalize());

  describe("GET /scoring/match/:id state", () => {
    beforeEach(() => {
      return provider.addInteraction({
        state: "match with id match_123 exists",
        uponReceiving: "a request for match state",
        withRequest: {
          method: "GET",
          path: "/scoring/match/match_123",
          headers: {
            Accept: "application/json",
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
          body: {
            matchId: "match_123",
            status: "in_progress",
            currentInnings: 1,
          },
        },
      });
    });

    it("returns the correct match status and innings info", async () => {
      const response = await fetch("http://localhost:1234/scoring/match/match_123", {
        headers: { Accept: "application/json" },
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        matchId: "match_123",
        status: "in_progress",
        currentInnings: 1,
      });

      return provider.verify();
    });
  });
});
