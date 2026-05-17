import { describe, it, expect, beforeEach } from "vitest";
import { SessionStore } from "../src/session";

let store: SessionStore;

beforeEach(() => {
  store = new SessionStore(":memory:", 30);
});

describe("SessionStore", () => {
  it("returns null for a user with no session", () => {
    expect(store.get(123)).toBeNull();
  });

  it("creates and retrieves a session", () => {
    store.upsert(123, "sid-abc", 456);
    const s = store.get(123);
    expect(s).not.toBeNull();
    expect(s!.claudeSessionId).toBe("sid-abc");
    expect(s!.chatId).toBe(456);
  });

  it("updates last_active_at on touch", () => {
    store.upsert(123, "sid-abc", 456);
    const before = store.get(123)!.lastActiveAt;
    // Wait 5ms to ensure timestamp diff
    const wait = Date.now() + 5;
    while (Date.now() < wait) {}
    store.touch(123);
    const after = store.get(123)!.lastActiveAt;
    expect(after).toBeGreaterThan(before);
  });

  it("treats sessions older than TTL as expired (returns null)", () => {
    store = new SessionStore(":memory:", 0);  // TTL 0 minutes = always expired
    store.upsert(123, "sid-abc", 456);
    // Bypass: directly stale the row via the test-only helper
    store.testForceLastActiveAt(123, Date.now() - 60_000);
    expect(store.get(123)).toBeNull();
  });

  it("reset() drops the row", () => {
    store.upsert(123, "sid-abc", 456);
    store.reset(123);
    expect(store.get(123)).toBeNull();
  });

  it("stores and retrieves a callback intent", () => {
    store.putCallback(99, "tok123", "apply propagation set 1,2,3");
    expect(store.getCallback(99, "tok123")).toBe("apply propagation set 1,2,3");
  });

  it("deleteCallback removes a one-shot entry", () => {
    store.putCallback(99, "tok123", "do thing");
    store.deleteCallback(99, "tok123");
    expect(store.getCallback(99, "tok123")).toBeNull();
  });
});
