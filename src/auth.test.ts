import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAuthToken, getProfileUserInfo } from "./auth";

beforeEach(() => {
  vi.stubGlobal("chrome", {
    identity: {
      getAuthToken: vi.fn((_opts, cb) => cb("token-abc")),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ sub: "1", email: "a@example.com" }),
      })
    )
  );
});

describe("getAuthToken", () => {
  it("passes interactive flag through to chrome.identity.getAuthToken", async () => {
    await getAuthToken(false);
    expect(chrome.identity.getAuthToken).toHaveBeenCalledWith(
      { interactive: false },
      expect.any(Function)
    );
  });
});

describe("getProfileUserInfo", () => {
  it("requests a token without forcing an interactive prompt when interactive=false", async () => {
    await getProfileUserInfo(false);
    expect(chrome.identity.getAuthToken).toHaveBeenCalledWith(
      { interactive: false },
      expect.any(Function)
    );
  });
});
