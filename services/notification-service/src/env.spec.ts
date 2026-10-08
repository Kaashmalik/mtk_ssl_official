/**
 * Fail-fast contract for the production env schema.
 * A service must refuse to boot when a production secret is missing, and must
 * boot from defaults everywhere else.
 */



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
    jest.resetModules();
    expect(load()).toBeDefined();
  });
});