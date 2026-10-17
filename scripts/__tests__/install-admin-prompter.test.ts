import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createPrompter } from "../install-admin";

/** The question must be the last thing drawn: nothing may erase it afterwards (only cursor moves follow). */
const CURSOR_MOVE = /\u001b\[\d+G/g;
const endsWithQuestion = (text: string, label: string): boolean =>
  text.replace(CURSOR_MOVE, "").endsWith(`${label}: `);

function fakeTerminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  const seen = { text: "" };
  output.on("data", (chunk: Buffer) => {
    seen.text += chunk.toString();
  });
  return { input, output, seen };
}

describe("install prompter on a terminal", () => {
  it("leaves the question visible while it waits for the answer", async () => {
    const { input, output, seen } = fakeTerminal();
    const prompter = createPrompter({ input, output, isTty: true });
    const answer = prompter.ask("Organization name", false);
    expect(endsWithQuestion(seen.text, "Organization name")).toBe(true);
    input.write("Synthetic Org\n");
    expect(await answer).toBe("Synthetic Org");
    prompter.close();
  });

  it("shows the question of a hidden answer but never echoes the typed secret", async () => {
    const { input, output, seen } = fakeTerminal();
    const prompter = createPrompter({ input, output, isTty: true });
    const answer = prompter.ask("Admin password", true);
    expect(endsWithQuestion(seen.text, "Admin password")).toBe(true);
    input.write("s3cret-value\n");
    expect(await answer).toBe("s3cret-value");
    expect(seen.text).not.toContain("s3cret-value");
    prompter.close();
  });

  it("refuses to ask without a terminal", async () => {
    const { input, output } = fakeTerminal();
    const prompter = createPrompter({ input, output, isTty: false });
    await expect(prompter.ask("Organization name", false)).rejects.toThrow("no terminal available");
    prompter.close();
  });
});
