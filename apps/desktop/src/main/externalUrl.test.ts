import assert from "node:assert/strict";
import { test } from "node:test";

import { isTrustedExternalUrl } from "./externalUrl.js";

test("isTrustedExternalUrl accepts explicitly allowed protocols", () => {
  assert.equal(isTrustedExternalUrl("https://example.com"), true);
  assert.equal(isTrustedExternalUrl("http://127.0.0.1:3000/path"), true);
  assert.equal(isTrustedExternalUrl("mailto:test@example.com"), true);
});

test("isTrustedExternalUrl rejects malformed or dangerous URLs", () => {
  assert.equal(isTrustedExternalUrl("javascript:alert(1)"), false);
  assert.equal(isTrustedExternalUrl("file:///C:/Windows/System32"), false);
  assert.equal(isTrustedExternalUrl("not a url"), false);
});
