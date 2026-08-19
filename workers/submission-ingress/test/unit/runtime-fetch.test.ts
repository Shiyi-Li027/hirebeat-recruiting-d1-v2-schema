import assert from "node:assert/strict";
import { runtimeFetch } from "../../../shared/runtime-fetch";

const originalFetch = globalThis.fetch;

try {
  let observedReceiver: unknown;
  globalThis.fetch = (function (this: unknown) {
    observedReceiver = this;
    return Promise.resolve(new Response("ok"));
  }) as typeof fetch;

  const response = await runtimeFetch("https://example.invalid/test");

  assert.equal(await response.text(), "ok");
  assert.equal(observedReceiver, globalThis);
  console.log("Runtime fetch receiver regression test passed.");
} finally {
  globalThis.fetch = originalFetch;
}
