import { describe, it, expect } from "vitest";
import { sanitizeCss } from "../components/tenant-branding-provider";

describe("CSS Injection Sanitizer", () => {
  it("should pass standard safe CSS styles untouched", () => {
    const safeCss = `
      body {
        background-color: #f3f4f6;
        color: var(--primary);
      }
      .card {
        border-radius: 8px;
        box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
      }
    `;

    const result = sanitizeCss(safeCss);
    expect(result.trim()).toBe(safeCss.trim());
  });

  it("should strip expression() blocks to block IE-style CSS attacks", () => {
    const maliciousCss = `
      body {
        width: expression(alert('XSS'));
      }
    `;

    const result = sanitizeCss(maliciousCss);
    expect(result).not.toContain("expression");
    expect(result).not.toContain("alert");
  });

  it("should strip javascript: URIs and script tags to prevent script injection", () => {
    const maliciousCss = `
      .header {
        background: url(javascript:alert('XSS'));
      }
      <script>alert('malicious')</script>
    `;

    const result = sanitizeCss(maliciousCss);
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("javascript:");
  });

  it("should remove @import statements to prevent loading external malicious stylesheets", () => {
    const maliciousCss = `
      @import url("https://malicious.site/xss.css");
      .content {
        padding: 20px;
      }
    `;

    const result = sanitizeCss(maliciousCss);
    expect(result).not.toContain("@import");
    expect(result).toContain(".content");
  });

  it("should strip behavior: rules", () => {
    const maliciousCss = `
      p {
        behavior: url(somebehave.htc);
      }
    `;

    const result = sanitizeCss(maliciousCss);
    expect(result).not.toContain("behavior");
  });
});
