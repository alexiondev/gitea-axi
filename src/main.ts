#!/usr/bin/env node
import { runCli } from "./cli.js";

// Exit quietly when the consumer closes the pipe early (e.g. `gitea-axi | head`).
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") {
    process.exit(0);
  }
  throw error;
});

await runCli({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd(),
  stdout: process.stdout,
});
