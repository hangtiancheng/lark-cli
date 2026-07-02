import { describe, test, expect } from "vitest";
import { CodeReviewManager, createDefaultCodeReviewTeam } from "../src/code-review/manager.js";
import { ReviewSession } from "../src/code-review/session.js";
import { TeamManager } from "../src/teams/team.js";

describe("CodeReviewManager", () => {
  const workDir = "/tmp/test-code-review";
  const teamManager = new TeamManager(workDir);
  const manager = new CodeReviewManager(workDir, teamManager);

  test("should create a 3-person review team", () => {
    const team = manager.createTeam("frontend-team", [
      {
        name: "lark.go",
        email: "lark.go@company.com",
        role: "lead",
        expertise: ["architecture", "security"],
      },
      {
        name: "lark.qa",
        email: "lark.qa@company.com",
        role: "reviewer",
        expertise: ["testing", "documentation"],
      },
      {
        name: "lark.js",
        email: "lark.js@company.com",
        role: "reviewer",
        expertise: ["typescript", "frontend"],
      },
    ]);

    expect(team.name).toBe("frontend-team");
    expect(team.members).toHaveLength(3);
    expect(team.members[0].role).toBe("lead");
    expect(team.members[1].role).toBe("reviewer");
    expect(team.members[2].role).toBe("reviewer");
  });

  test("should get active reviewers", () => {
    /** const team = */ manager.createTeam("backend-team", [
      {
        name: "lark.go",
        email: "lark.go@company.com",
        role: "lead",
        expertise: ["backend"],
      },
      {
        name: "lark.qa",
        email: "lark.qa@company.com",
        role: "reviewer",
        expertise: ["api"],
      },
      {
        name: "lark.js",
        email: "lark.js@company.com",
        role: "reviewer",
        expertise: ["database"],
      },
    ]);

    const reviewers = manager.getActiveReviewers("backend-team");
    expect(reviewers).toHaveLength(2); // 2 reviewers, not including lead
    expect(reviewers.every((r) => r.role === "reviewer")).toBe(true);
  });

  test("should deactivate and activate members", () => {
    /** const team = */ manager.createTeam("mobile-team", [
      {
        name: "lark.js",
        email: "lark.js@company.com",
        role: "lead",
        expertise: ["mobile"],
      },
      {
        name: "lark.swift",
        email: "lark.swift@company.com",
        role: "reviewer",
        expertise: ["ios"],
      },
      {
        name: "lark.kt",
        email: "lark.kt@company.com",
        role: "reviewer",
        expertise: ["android"],
      },
    ]);

    manager.deactivateMember("mobile-team", "lark.swift");
    let reviewers = manager.getActiveReviewers("mobile-team");
    expect(reviewers).toHaveLength(1); // Only lark.kt is active now

    manager.activateMember("mobile-team", "lark.swift");
    reviewers = manager.getActiveReviewers("mobile-team");
    expect(reviewers).toHaveLength(2); // Both lark.swift and lark.kt are active
  });

  test("should create default review team", () => {
    const defaultTeam = createDefaultCodeReviewTeam();
    expect(defaultTeam.name).toBe("default-review");
    expect(defaultTeam.members).toHaveLength(3);
    expect(defaultTeam.members[0].name).toBe("lark.go");
    expect(defaultTeam.members[1].name).toBe("lark.qa");
    expect(defaultTeam.members[2].name).toBe("lark.js");
  });

  test("should provide team summary", () => {
    manager.createTeam("summary-team", [
      {
        name: "lark.go",
        email: "lark.go@company.com",
        role: "lead",
        expertise: ["summary"],
      },
      {
        name: "lark.qa",
        email: "lark.qa@company.com",
        role: "reviewer",
        expertise: ["testing"],
      },
      {
        name: "lark.js",
        email: "lark.js@company.com",
        role: "reviewer",
        expertise: ["docs"],
      },
    ]);

    const summary = manager.getTeamSummary("summary-team");
    expect(summary).toContain("summary-team");
    expect(summary).toContain("3/3 active");
    expect(summary).toContain("Reviewers: 2");
    expect(summary).toContain("Leads: 1");
  });
});

describe("ReviewSession", () => {
  const workDir = "/tmp/test-review-session";
  const teamManager = new TeamManager(workDir);
  const manager = new CodeReviewManager(workDir, teamManager);
  const session = new ReviewSession(workDir, manager);

  test("should create review request", () => {
    manager.createTeam("test-team", [
      {
        name: "reviewer1",
        email: "reviewer1@company.com",
        role: "lead",
        expertise: ["testing"],
      },
      {
        name: "reviewer2",
        email: "reviewer2@company.com",
        role: "reviewer",
        expertise: ["docs"],
      },
      {
        name: "reviewer3",
        email: "reviewer3@company.com",
        role: "reviewer",
        expertise: ["code"],
      },
    ]);

    const request = session.createReviewRequest(
      "test-team",
      "Fix authentication bug",
      "Users cannot login after password reset",
      "john",
      "feature/auth-fix",
      ["src/auth/login.ts"],
    );

    expect(request.title).toBe("Fix authentication bug");
    expect(request.author).toBe("john");
    expect(request.reviewers).toHaveLength(2); // 2 active reviewers
    expect(request.status).toBe("pending");
  });

  test("should add and manage comments", () => {
    const request = session.createReviewRequest(
      "test-team",
      "Add unit tests",
      "Missing test coverage",
      "jane",
      "feature/tests",
      ["src/utils/math.ts"],
    );

    const comment1 = session.addComment(
      request.id,
      "reviewer2",
      "Please add tests for edge cases",
      "src/utils/math.ts",
      42,
    );

    const comment2 = session.addComment(
      request.id,
      "reviewer3",
      "Consider using parameterized tests",
      "src/utils/math.ts",
      50,
    );

    expect(comment1.content).toBe("Please add tests for edge cases");
    expect(comment2.line).toBe(50);
    expect(comment1.resolution).toBeUndefined();
  });

  test("should accept and reject comments with responses", () => {
    const request = session.createReviewRequest(
      "test-team",
      "Refactor API client",
      "Improve error handling",
      "john",
      "refactor/api-client",
      ["src/api/client.ts"],
    );

    const comment = session.addComment(
      request.id,
      "reviewer2",
      "Add retry logic for failed requests",
      "src/api/client.ts",
      78,
    );

    // Accept the comment with author response
    session.acceptComment(
      request.id,
      comment.id,
      "Good suggestion, will implement exponential backoff",
    );

    const updatedRequest = session.getRequest(request.id);
    const updatedComment = updatedRequest?.comments.find((c) => c.id === comment.id);

    expect(updatedComment?.resolution).toBe("accepted");
    expect(updatedComment?.authorResponse).toBe(
      "Good suggestion, will implement exponential backoff",
    );
    expect(updatedComment?.resolved).toBe(true);
  });

  test("should generate final review report", () => {
    const request = session.createReviewRequest(
      "test-team",
      "Security improvements",
      "Add input validation and sanitization",
      "jane",
      "security/input-validation",
      ["src/validators/input.ts", "src/handlers/user.ts"],
    );

    // Add multiple comments with different resolutions
    const comment1 = session.addComment(
      request.id,
      "reviewer2",
      "Add input length validation to prevent DoS attacks",
      "src/validators/input.ts",
      15,
    );

    const comment2 = session.addComment(
      request.id,
      "reviewer3",
      "Sanitize user input before database queries",
      "src/handlers/user.ts",
      32,
    );

    const comment3 = session.addComment(
      request.id,
      "reviewer2",
      "Consider using a validation library like Zod",
      "src/validators/input.ts",
      8,
    );

    // Accept some, reject some
    session.acceptComment(request.id, comment1.id, "Will implement max length validation");
    session.acceptComment(
      request.id,
      comment2.id,
      "Already using parameterized queries, but will add additional sanitization",
    );
    session.rejectComment(
      request.id,
      comment3.id,
      "Prefer to keep it simple with built-in validation for now",
    );

    const summary = session.generateFinalReport(request.id);

    expect(summary.requestId).toBe(request.id);
    expect(summary.totalComments).toBe(3);
    expect(summary.acceptedSuggestions).toBe(2);
    expect(summary.rejectedSuggestions).toBe(1);
    expect(summary.keyFindings).toHaveLength(2); // Only accepted/pending comments
    expect(summary.fileSpecificFeedback.size).toBe(2);
  });

  test("should format final report correctly", () => {
    const request = session.createReviewRequest(
      "test-team",
      "Performance optimization",
      "Reduce API response time",
      "jane",
      "perf/api-optimization",
      ["src/api/endpoints.ts"],
    );

    const comment1 = session.addComment(
      request.id,
      "reviewer2",
      "Add database indexing for frequently queried fields",
      "src/api/endpoints.ts",
      120,
    );

    const comment2 = session.addComment(
      request.id,
      "reviewer3",
      "Implement response caching",
      "src/api/endpoints.ts",
      85,
    );

    session.acceptComment(
      request.id,
      comment1.id,
      "Will add composite index on user_id and timestamp",
    );
    session.acceptComment(request.id, comment2.id, "Good point, will implement Redis caching");

    const summary = session.generateFinalReport(request.id);
    const report = session.formatFinalReport(summary);

    expect(report).toContain("CODE REVIEW FINAL REPORT");
    expect(report).toContain("Performance optimization");
    expect(report).toContain("* Accepted Suggestions:  2");
    expect(report).toContain("src/api/endpoints.ts");
    expect(report).toContain("Will add composite index on user_id and timestamp");
    expect(report).toContain("Good point, will implement Redis caching");
  });

  test("should determine overall conclusion correctly", () => {
    // Test approved scenario
    let request = session.createReviewRequest(
      "test-team",
      "Simple refactor",
      "Code cleanup",
      "john",
      "refactor/cleanup",
      ["src/utils/helpers.ts"],
    );

    let comment = session.addComment(request.id, "reviewer2", "Minor style improvement");
    session.acceptComment(request.id, comment.id);

    let summary = session.generateFinalReport(request.id);
    expect(summary.overallConclusion).toBe("approved");

    // Test rejected scenario
    request = session.createReviewRequest(
      "test-team",
      "Breaking changes",
      "Major API changes",
      "jane",
      "breaking/api",
      ["src/api/v2.ts"],
    );

    for (let i = 0; i < 5; i++) {
      comment = session.addComment(request.id, "reviewer2", `Critical issue ${String(i + 1)}`);
      session.rejectComment(request.id, comment.id, "Cannot fix due to time constraints");
    }

    summary = session.generateFinalReport(request.id);
    expect(summary.overallConclusion).toBe("rejected");

    // Test changes requested scenario
    request = session.createReviewRequest(
      "test-team",
      "Mixed feedback",
      "Some issues to address",
      "john",
      "feature/mixed",
      ["src/components/button.tsx"],
    );

    comment = session.addComment(request.id, "reviewer2", "Good implementation");
    session.acceptComment(request.id, comment.id);

    comment = session.addComment(request.id, "reviewer3", "Missing error handling");
    session.rejectComment(request.id, comment.id, "Will add in next iteration");

    summary = session.generateFinalReport(request.id);
    expect(summary.overallConclusion).toBe("changes-requested");
  });
});
