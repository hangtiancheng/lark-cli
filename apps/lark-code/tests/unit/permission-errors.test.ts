import { describe, expect, test } from "vitest";
import { PermissionDeniedError } from "../../src/core/permissions/errors.js";

describe("Permission Errors", () => {
  // Feature: PermissionDeniedError is an Error instance
  // Design: Create error, verify instanceof
  test("is Error instance", () => {
    const err = new PermissionDeniedError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PermissionDeniedError);
  });

  // Feature: PermissionDeniedError has correct name
  // Design: Create error, verify name property
  test("has correct name", () => {
    const err = new PermissionDeniedError();
    expect(err.name).toBe("PermissionDeniedError");
  });

  // Feature: PermissionDeniedError uses default message
  // Design: Create without message, verify default
  test("uses default message", () => {
    const err = new PermissionDeniedError();
    expect(err.message).toBe("Permission denied");
  });

  // Feature: PermissionDeniedError accepts custom message
  // Design: Create with custom message, verify
  test("accepts custom message", () => {
    const err = new PermissionDeniedError("Tool bash not allowed");
    expect(err.message).toBe("Tool bash not allowed");
  });

  // Feature: PermissionDeniedError has stack trace
  // Design: Create error, verify stack is present
  test("has stack trace", () => {
    const err = new PermissionDeniedError();
    expect(typeof err.stack).toBe("string");
    expect(err.stack?.length ?? 0).toBeGreaterThan(0);
  });
});
