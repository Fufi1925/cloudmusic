import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * DiscordLoginActivity reads the token with a small JS snippet that runs inside
 * the in-app browser. This test pulls the exact literal out of the Java source
 * and executes it, so the snippet cannot silently rot.
 */
const JAVA_SOURCE = resolve(
  process.cwd(),
  "android/app/src/main/java/com/hkamori/cloudmusic/DiscordLoginActivity.java",
);

function javaStringLiteral(block: string): string {
  const parts: string[] = [];
  let index = 0;
  while (index < block.length) {
    const start = block.indexOf('"', index);
    if (start === -1) break;
    let i = start + 1;
    let value = "";
    while (i < block.length && block[i] !== '"') {
      if (block[i] === "\\") {
        const next = block[i + 1];
        value += next === "n" ? "\n" : next === "t" ? "\t" : next;
        i += 2;
      } else {
        value += block[i];
        i += 1;
      }
    }
    parts.push(value);
    index = i + 1;
  }
  return parts.join("");
}

function extractConstant(name: string): string {
  const source = readFileSync(JAVA_SOURCE, "utf-8");
  const start = source.indexOf(`String ${name}`);
  if (start === -1) throw new Error(`${name} not found in DiscordLoginActivity.java`);
  const from = source.indexOf("=", start) + 1;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === ";") {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error(`${name} literal is not terminated`);
  return javaStringLiteral(source.slice(from, end));
}

const READ_TOKEN_JS = extractConstant("READ_TOKEN_JS");

function runSnippet(): string | null {
  return new Function(`return ${READ_TOKEN_JS};`)() as string | null;
}

describe("discord login token snippet", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the token the discord web client stored", () => {
    const token = ["MTk4NjIyNDgzNDcxOTI1MjQ4", "Gh0st", "u1EOxP8m6VvQ6Y8I0Qx4Qv9s3Zk"].join(".");
    window.localStorage.setItem("token", JSON.stringify(token));
    expect(runSnippet()).toBe(token);
  });

  it("returns null while not logged in", () => {
    expect(runSnippet()).toBeNull();
  });

  it("ignores non-string or malformed values", () => {
    window.localStorage.setItem("token", JSON.stringify({ token: "x" }));
    expect(runSnippet()).toBeNull();

    window.localStorage.setItem("token", JSON.stringify("short"));
    expect(runSnippet()).toBeNull();

    window.localStorage.setItem(
      "token",
      JSON.stringify("has space MTk4NjIyNDgzNDcxOTI1MjQ4.Gh0st.u1EOxP8m6VvQ6Y8I0Qx4Qv9s3"),
    );
    expect(runSnippet()).toBeNull();
  });
});
