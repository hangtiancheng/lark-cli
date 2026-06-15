// Feature: Verify JsonRpcRequest serialization and deserialization preserves all field values
// Design: JSON roundtrip (JSON.stringify → JSON.parse → schema.parse) confirms field integrity, the basic contract of NDJSON wire protocol
import { describe, expect, test } from "vitest";
import { ZodError } from "zod";

import {
  JsonRpcRequestSchema,
  JsonRpcSuccessSchema,
  PARSE_ERROR,
  makeError,
} from "../../src/core/bus/envelope.js";

describe("JsonRpcRequest", () => {
  test("roundtrip preserves all fields", () => {
    const req = JsonRpcRequestSchema.parse({
      id: "1",
      method: "core.ping",
      params: { client: "test" },
    });
    const json = JSON.stringify(req);
    const req2 = JsonRpcRequestSchema.parse(JSON.parse(json));
    expect(req2.id).toBe("1");
    expect(req2.method).toBe("core.ping");
    expect(req2.params).toEqual({ client: "test" });
  });

  // Feature: Verify params field defaults to empty object instead of undefined
  // Design: Parse without params field, confirm default is {} to avoid handlers checking for undefined
  test("default params is empty object", () => {
    const req = JsonRpcRequestSchema.parse({ id: "1", method: "x" });
    expect(req.params).toEqual({});
  });

  // Feature: Verify zod validation fails when required id field is missing
  // Design: Pass object without id, confirm id is a required field
  test("missing id raises ZodError", () => {
    expect(() => JsonRpcRequestSchema.parse({ jsonrpc: "2.0", method: "x" })).toThrow(ZodError);
  });

  // Feature: Verify zod validation fails when jsonrpc field is not "2.0"
  // Design: Pass "1.0" to confirm z.literal("2.0") constraint works
  test("wrong version raises ZodError", () => {
    expect(() => JsonRpcRequestSchema.parse({ jsonrpc: "1.0", id: "1", method: "x" })).toThrow(
      ZodError,
    );
  });
});

describe("JsonRpcSuccess", () => {
  // Feature: Verify JsonRpcSuccess roundtrip preserves nested result structure
  // Design: result is unknown type, roundtrip test confirms nested objects are not dropped or flattened
  test("roundtrip preserves nested result", () => {
    const resp = JsonRpcSuccessSchema.parse({
      id: "1",
      result: { key: "value" },
    });
    const json = JSON.stringify(resp);
    const resp2 = JsonRpcSuccessSchema.parse(JSON.parse(json));
    expect(resp2.id).toBe("1");
    expect(resp2.result).toEqual({ key: "value" });
  });
});

describe("makeError", () => {
  // Feature: Verify makeError factory correctly sets code and id fields, data defaults to null
  // Design: Pass named error code constant (PARSE_ERROR), confirm factory does not alter error code value
  test("sets code and id, data defaults to null", () => {
    const err = makeError("1", PARSE_ERROR, "Parse error");
    expect(err.error.code).toBe(PARSE_ERROR);
    expect(err.id).toBe("1");
    expect(err.error.data).toBeNull();
  });

  // Feature: Verify makeError accepts null id (for error responses when request id cannot be parsed)
  // Design: JSON-RPC spec allows id=null when id cannot be parsed
  test("accepts null id", () => {
    const err = makeError(null, PARSE_ERROR, "bad json");
    expect(err.id).toBeNull();
  });
});
