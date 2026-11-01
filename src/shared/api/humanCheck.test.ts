import { afterEach, describe, expect, it } from "vitest";
import {
  HumanCheckCancelledError,
  HumanCheckFailedError,
  runHumanCheck,
  setHumanCheckPrompt,
} from "./humanCheck";

describe("runHumanCheck", () => {
  afterEach(() => setHumanCheckPrompt(null));

  it("returns the token the panel produced", async () => {
    setHumanCheckPrompt(async () => "token-1");
    await expect(runHumanCheck("login", "required")).resolves.toBe("token-1");
  });

  it("treats a closed panel as a cancel, never as a retry", async () => {
    setHumanCheckPrompt(async () => ({ token: null, failure: "cancelled" }));
    const error = await runHumanCheck("login", "required").catch((value) => value);
    expect(error).toBeInstanceOf(HumanCheckCancelledError);
  });

  it("reports a stuck widget instead of hanging", async () => {
    setHumanCheckPrompt(async () => ({ token: null, failure: "timeout" }));
    const error = await runHumanCheck("register", "required").catch((value) => value);
    expect(error).toBeInstanceOf(HumanCheckFailedError);
    expect(error.reason).toBe("timeout");
  });

  it("keeps optional checks forgiving", async () => {
    setHumanCheckPrompt(async () => ({ token: null, failure: "error" }));
    await expect(runHumanCheck("login", "optional")).resolves.toBeUndefined();
  });

  it("skips entirely when the api does not ask", async () => {
    let asked = 0;
    setHumanCheckPrompt(async () => {
      asked += 1;
      return "unused";
    });
    await expect(runHumanCheck("login", "off")).resolves.toBeUndefined();
    expect(asked).toBe(0);
  });
});
