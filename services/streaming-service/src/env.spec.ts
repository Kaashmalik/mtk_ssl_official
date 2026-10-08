/**
 * Fail-fast contract for the production env schema.
 * A service must refuse to boot when a production secret is missing, and must
 * boot from defaults everywhere else.
 */

const REQUIRED_IN_PROD: string[] = [    "STREAMING_ACCESS_TOKEN"];

function load(): unknown {
  return require("./env").env;
}

describe("env schema", () => {
  const original: Record<string, string | undefined> = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.resetModules();
  });

  it("parses with defaults when not in production", () => {
    process.env.NODE_ENV = "test";
    for (const key of REQUIRED_IN_PROD) delete process.env[key];
    jest.resetModules();
    expect(load()).toBeDefined();
  });

  it("refuses to boot in production while STREAMING_ACCESS_TOKEN is missing", () => {
    process.env.NODE_ENV = "production";
    for (const key of REQUIRED_IN_PROD) delete process.env[key];
    jest.resetModules();
    expect(() => load()).toThrow(/STREAMING_ACCESS_TOKEN is required in production/);
  });

  it("boots in production once every required secret is set", () => {
    process.env.NODE_ENV = "production";
    for (const key of REQUIRED_IN_PROD) process.env[key] = "test-secret-value";
    jest.resetModules();
    expect(load()).toBeDefined();
  });
});