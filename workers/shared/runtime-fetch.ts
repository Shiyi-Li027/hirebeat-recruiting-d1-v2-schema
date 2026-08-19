export type RuntimeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

// Some edge runtimes require native fetch to retain the global receiver.
// Keep this adapter as the production default while still allowing tests to
// inject deterministic Fetch implementations.
export const runtimeFetch: RuntimeFetch = (input, init) =>
  globalThis.fetch(input, init);
