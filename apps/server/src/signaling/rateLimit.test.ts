import assert from "node:assert/strict";
import { test } from "node:test";

import { SlidingWindowRateLimiter, readPositiveIntegerEnv } from "./rateLimit.js";

test("SlidingWindowRateLimiter blocks events over the window limit", () => {
  const limiter = new SlidingWindowRateLimiter(2, 1_000);

  assert.equal(limiter.consume("client", 1_000), true);
  assert.equal(limiter.consume("client", 1_500), true);
  assert.equal(limiter.consume("client", 1_700), false);
  assert.equal(limiter.consume("client", 2_501), true);
});

test("SlidingWindowRateLimiter can check, record and reset independently", () => {
  const limiter = new SlidingWindowRateLimiter(1, 1_000);

  assert.equal(limiter.isAllowed("password", 100), true);
  limiter.record("password", 100);
  assert.equal(limiter.isAllowed("password", 200), false);
  limiter.reset("password");
  assert.equal(limiter.isAllowed("password", 200), true);
});

test("readPositiveIntegerEnv falls back for unset or invalid values", () => {
  const previous = process.env.REMOTE_CONTROL_TEST_LIMIT;
  try {
    delete process.env.REMOTE_CONTROL_TEST_LIMIT;
    assert.equal(readPositiveIntegerEnv("REMOTE_CONTROL_TEST_LIMIT", 5), 5);

    process.env.REMOTE_CONTROL_TEST_LIMIT = "0";
    assert.equal(readPositiveIntegerEnv("REMOTE_CONTROL_TEST_LIMIT", 5), 5);

    process.env.REMOTE_CONTROL_TEST_LIMIT = "7";
    assert.equal(readPositiveIntegerEnv("REMOTE_CONTROL_TEST_LIMIT", 5), 7);
  } finally {
    if (previous === undefined) {
      delete process.env.REMOTE_CONTROL_TEST_LIMIT;
    } else {
      process.env.REMOTE_CONTROL_TEST_LIMIT = previous;
    }
  }
});
