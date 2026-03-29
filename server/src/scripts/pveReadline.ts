import * as readline from "node:readline";

/** Single-line prompt; closes the interface after each call (simple scripts). */
export function question(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function isStdinTty(): boolean {
  return Boolean(process.stdin.isTTY);
}
