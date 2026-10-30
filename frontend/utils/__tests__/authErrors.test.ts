// Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.
import {
  AuthError,
  classifyAuthError,
  isRetryable,
  retryWithBackoff,
} from "@/utils/authErrors";

describe("classifyAuthError", () => {
  it("a 400 carrying invalid_grant is the one kind that ends a session", () => {
    expect(
      classifyAuthError({ status: 400, body: { error: "invalid_grant" } })
    ).toBe("invalid_grant");
  });

  it("a 400 carrying any other OAuth error is a client error, not invalid_grant", () => {
    expect(
      classifyAuthError({
        status: 400,
        body: { error: "invalid_request", error_description: "missing param" },
      })
    ).toBe("client");
  });

  it("a 400 with no body at all is a client error", () => {
    expect(classifyAuthError({ status: 400 })).toBe("client");
    expect(classifyAuthError({ status: 400, body: null })).toBe("client");
  });

  it.each([401, 403, 404])("%i is a client error", (status) => {
    expect(classifyAuthError({ status })).toBe("client");
  });

  it.each([429, 500, 502, 503])("%i is a server error", (status) => {
    expect(classifyAuthError({ status })).toBe("server");
  });

  it("classifies from the status first, even when an error was also thrown", () => {
    expect(
      classifyAuthError({
        status: 503,
        error: new SyntaxError("Unexpected token < in JSON"),
      })
    ).toBe("server");
  });

  it("falls through to the thrown error for a sub-400 status", () => {
    expect(
      classifyAuthError({ status: 200, error: new SyntaxError("bad json") })
    ).toBe("unknown");
  });

  it("an AbortError is a timeout", () => {
    const aborted = new Error("Aborted");
    aborted.name = "AbortError";
    expect(classifyAuthError({ error: aborted })).toBe("timeout");
  });

  it("a TypeError is a network failure", () => {
    expect(classifyAuthError({ error: new TypeError("boom") })).toBe("network");
  });

  it.each([
    "Network request failed",
    "Failed to fetch",
    "network error while posting",
    "NETWORK ERROR",
  ])("network wording %p is a network failure", (message) => {
    expect(classifyAuthError({ error: new Error(message) })).toBe("network");
  });

  it("a SyntaxError (malformed JSON, jwtDecode throw) is unknown", () => {
    expect(classifyAuthError({ error: new SyntaxError("bad json") })).toBe(
      "unknown"
    );
  });

  it("an AuthError reports its own kind", () => {
    expect(
      classifyAuthError({ error: new AuthError("server", "upstream is down") })
    ).toBe("server");
  });

  it("anything else is unknown", () => {
    expect(classifyAuthError({ error: new Error("something odd") })).toBe(
      "unknown"
    );
    expect(classifyAuthError({ error: "a string" })).toBe("unknown");
    expect(classifyAuthError({})).toBe("unknown");
  });

  it("never reaches invalid_grant from message text alone", () => {
    expect(classifyAuthError({ error: new Error("invalid_grant") })).toBe(
      "unknown"
    );
    expect(
      classifyAuthError({ status: 401, body: { error: "invalid_grant" } })
    ).toBe("client");
  });
});

describe("isRetryable", () => {
  it.each(["network", "timeout", "server"] as const)(
    "%s is retryable",
    (kind) => {
      expect(isRetryable(kind)).toBe(true);
    }
  );

  it("invalid_grant is never retryable", () => {
    expect(isRetryable("invalid_grant")).toBe(false);
  });

  it.each(["client", "unknown"] as const)("%s is not retryable", (kind) => {
    expect(isRetryable(kind)).toBe(false);
  });
});

describe("retryWithBackoff", () => {
  const makeSleep = () => {
    const delays: number[] = [];
    const sleep = jest.fn(async (ms: number) => {
      delays.push(ms);
    });
    return { delays, sleep };
  };

  it("returns the first attempt's value without sleeping", async () => {
    const { sleep, delays } = makeSleep();
    const fn = jest.fn(async () => "ok");

    await expect(retryWithBackoff(fn, { sleep, random: () => 0 })).resolves.toBe(
      "ok"
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
    expect(delays).toEqual([]);
  });

  it("passes the attempt number to fn and resolves once it succeeds", async () => {
    const { sleep } = makeSleep();
    const fn = jest.fn(async (attempt: number) => {
      if (attempt < 2) {
        throw new AuthError("network", "offline");
      }
      return attempt;
    });

    await expect(retryWithBackoff(fn, { sleep, random: () => 0 })).resolves.toBe(
      2
    );
    expect(fn.mock.calls).toEqual([[1], [2]]);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable AuthError up to 3 attempts, then rethrows the last error", async () => {
    const { sleep } = makeSleep();
    const errors = [
      new AuthError("network", "first"),
      new AuthError("timeout", "second"),
      new AuthError("server", "third"),
    ];
    const fn = jest.fn(async (attempt: number) => {
      throw errors[attempt - 1];
    });

    await expect(
      retryWithBackoff(fn, { sleep, random: () => 0 })
    ).rejects.toBe(errors[2]);
    expect(fn).toHaveBeenCalledTimes(3);
    // No sleep after the final attempt.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry an invalid_grant AuthError", async () => {
    const { sleep } = makeSleep();
    const dead = new AuthError("invalid_grant", "refresh token is dead", {
      status: 400,
      oauthError: "invalid_grant",
    });
    const fn = jest.fn(async () => {
      throw dead;
    });

    await expect(retryWithBackoff(fn, { sleep, random: () => 0 })).rejects.toBe(
      dead
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a non-AuthError by default", async () => {
    const { sleep } = makeSleep();
    const plain = new Error("who knows");
    const fn = jest.fn(async () => {
      throw plain;
    });

    await expect(retryWithBackoff(fn, { sleep, random: () => 0 })).rejects.toBe(
      plain
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("sleeps 500 then 1000, plus jitter, with the injected random", async () => {
    const { sleep, delays } = makeSleep();
    const fn = jest.fn(async () => {
      throw new AuthError("server", "503");
    });

    await expect(
      retryWithBackoff(fn, { sleep, random: () => 0.5 })
    ).rejects.toBeInstanceOf(AuthError);
    expect(delays).toEqual([550, 1050]);
  });

  it("honours attempts, baseDelayMs, factor and jitterMs overrides", async () => {
    const { sleep, delays } = makeSleep();
    const fn = jest.fn(async () => {
      throw new AuthError("network", "offline");
    });

    await expect(
      retryWithBackoff(fn, {
        attempts: 4,
        baseDelayMs: 100,
        factor: 3,
        jitterMs: 0,
        sleep,
        random: () => 0.9,
      })
    ).rejects.toBeInstanceOf(AuthError);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([100, 300, 900]);
  });

  it("stops as soon as a custom shouldRetry says no", async () => {
    const { sleep } = makeSleep();
    const fn = jest.fn(async () => {
      throw new Error("nope");
    });
    const shouldRetry = jest.fn((_err: unknown, attempt: number) => attempt < 2);

    await expect(
      retryWithBackoff(fn, { sleep, random: () => 0, shouldRetry })
    ).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  describe("with waitUntilOnline", () => {
    // A connectivity gate the test opens by hand.
    const makeGate = () => {
      let open: () => void = () => {};
      const waitUntilOnline = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            open = resolve;
          })
      );
      return { waitUntilOnline, open: () => open() };
    };

    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it("makes no attempt until the device is online", async () => {
      const { sleep } = makeSleep();
      const { waitUntilOnline, open } = makeGate();
      const fn = jest.fn(async () => "ok");

      const result = retryWithBackoff(fn, {
        sleep,
        random: () => 0,
        waitUntilOnline,
      });
      await flush();
      expect(fn).not.toHaveBeenCalled();

      open();
      await expect(result).resolves.toBe("ok");
      expect(fn).toHaveBeenCalledWith(1);
    });

    it("does not spend an attempt while offline, however long that lasts", async () => {
      const { sleep } = makeSleep();
      const { waitUntilOnline, open } = makeGate();
      const fn = jest.fn(async (attempt: number) => {
        if (attempt < 3) throw new AuthError("network", "dropped");
        return attempt;
      });

      const result = retryWithBackoff(fn, {
        sleep,
        random: () => 0,
        waitUntilOnline,
      });

      // Each gate is one offline stretch: the attempt count only moves once it opens.
      for (let attempt = 1; attempt <= 3; attempt++) {
        await flush();
        expect(fn).toHaveBeenCalledTimes(attempt - 1);
        open();
      }

      await expect(result).resolves.toBe(3);
      expect(waitUntilOnline).toHaveBeenCalledTimes(3);
      expect(fn.mock.calls).toEqual([[1], [2], [3]]);
    });

    it("gives up with the wait's own error, without another attempt", async () => {
      const { sleep } = makeSleep();
      const gaveUp = new Error("deadline");
      const waitUntilOnline = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(gaveUp);
      const fn = jest.fn(async () => {
        throw new AuthError("network", "dropped");
      });
      const shouldRetry = jest.fn(() => true);

      await expect(
        retryWithBackoff(fn, {
          sleep,
          random: () => 0,
          waitUntilOnline,
          shouldRetry,
        })
      ).rejects.toBe(gaveUp);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledTimes(1);
    });

    it("still never retries an invalid_grant", async () => {
      const { sleep } = makeSleep();
      const waitUntilOnline = jest.fn(async () => {});
      const dead = new AuthError("invalid_grant", "refresh token is dead", {
        status: 400,
        oauthError: "invalid_grant",
      });
      const fn = jest.fn(async () => {
        throw dead;
      });

      await expect(
        retryWithBackoff(fn, { sleep, random: () => 0, waitUntilOnline })
      ).rejects.toBe(dead);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(waitUntilOnline).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });
  });
});

describe("AuthError", () => {
  it("carries its kind, status, oauthError and cause, and survives instanceof", () => {
    const cause = new Error("underlying");
    const error = new AuthError("invalid_grant", "refresh token rejected", {
      status: 400,
      oauthError: "invalid_grant",
      cause,
    });

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AuthError");
    expect(error.message).toBe("refresh token rejected");
    expect(error.kind).toBe("invalid_grant");
    expect(error.status).toBe(400);
    expect(error.oauthError).toBe("invalid_grant");
    expect((error as { cause?: unknown }).cause).toBe(cause);
  });
});
