import { describe, expect, it } from "vitest";
import { getSuggestions } from "../src/suggestions.js";

describe("getSuggestions", () => {
  it("suggests unpin when the branch is not main", () => {
    const lines = getSuggestions({
      name: "api-example",
      gitlabBranch: "feature/example",
    });
    expect(lines.join(" ")).toContain("dokploy-axi service unpin api-example");
  });

  it("suggests nothing extra when pinned to main", () => {
    expect(
      getSuggestions({ name: "api-example", gitlabBranch: "main" }),
    ).toEqual([]);
  });

  it("suggests logs when the status is error", () => {
    const lines = getSuggestions({ name: "worker-example", status: "error" });
    expect(lines.join(" ")).toContain("dokploy-axi logs worker-example");
  });

  it("suggests nothing extra for a healthy status", () => {
    expect(getSuggestions({ name: "api-example", status: "running" })).toEqual(
      [],
    );
  });

  it("combines both suggestions when both apply", () => {
    const lines = getSuggestions({
      name: "worker-example",
      status: "error",
      gitlabBranch: "feature/example",
    });
    expect(lines).toHaveLength(2);
  });
});
