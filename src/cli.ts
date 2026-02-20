import path from "node:path";
import os from "node:os";
import { CliOptions, OutputFormat } from "./types";

const AUTO_CONCURRENCY = Math.max(1, os.availableParallelism?.() ?? os.cpus().length ?? 1);

function getExecutableName(argv0: string): string {
  if (!argv0) {
    return "epub-mathml-converter";
  }
  return path.basename(argv0);
}

function looksLikeScriptPath(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.endsWith(".ts") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts") ||
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  );
}

function getCliArgs(argv: string[]): string[] {
  const executableName = getExecutableName(argv[0] ?? "").toLowerCase();
  const originalExecutableName = getExecutableName(process.argv0 ?? "").toLowerCase();
  const isBunOrNode = executableName.includes("bun") || executableName.startsWith("node");
  const second = argv[1] ?? "";

  const isBunCompiledWrapper =
    executableName.includes("bun") &&
    originalExecutableName.length > 0 &&
    !originalExecutableName.includes("bun");

  if (isBunCompiledWrapper) {
    return argv.slice(1);
  }

  const secondIsExecPath =
    second.length > 0 &&
    path.resolve(second) === path.resolve(process.execPath);

  if (isBunOrNode && secondIsExecPath) {
    return argv.slice(2);
  }

  if (isBunOrNode && looksLikeScriptPath(second)) {
    return argv.slice(2);
  }

  return argv.slice(1);
}

function getCommandName(argv: string[]): string {
  const executableName = getExecutableName(argv[0] ?? "");
  const originalExecutableName = getExecutableName(process.argv0 ?? "");
  const second = argv[1] ?? "";

  if (
    executableName.toLowerCase().includes("bun") &&
    originalExecutableName.length > 0 &&
    !originalExecutableName.toLowerCase().includes("bun")
  ) {
    return originalExecutableName;
  }

  if (
    executableName.toLowerCase().includes("bun") &&
    second.length > 0 &&
    path.resolve(second) === path.resolve(process.execPath)
  ) {
    return getExecutableName(process.execPath);
  }

  if (executableName.toLowerCase().includes("bun") && looksLikeScriptPath(second)) {
    const scriptName = path.basename(second);
    return `bun run ${scriptName}`;
  }
  return executableName || "epub-mathml-converter";
}

export function printHelp(): void {
  const command = getCommandName(process.argv);
  console.log(`Usage:
  ${command} <input.epub> [output.epub] [--format png|svg] [--concurrency N|auto]

Examples:
  ${command} tes.epub
  ${command} tes.epub tes-kindle.epub
  ${command} tes.epub --format svg
  ${command} tes.epub tes-kindle.svg.epub --format svg
  ${command} tes.epub --format png --concurrency auto
  ${command} tes.epub --format png --concurrency 4

Notes:
  - Uses built-in zip handling (no external zip/unzip commands needed)
  - --format defaults to png
  - --concurrency defaults to auto (${AUTO_CONCURRENCY} on this machine)
  - png: replaces <math> with <img src="data:image/png;base64,...">
  - svg: replaces <math> with inline <svg>
`);
}

export function parseArgs(argv: string[]): CliOptions {
  const args = getCliArgs(argv);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  let format: OutputFormat = "png";
  let concurrency = AUTO_CONCURRENCY;
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--format") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --format. Use png or svg.");
      }
      if (value !== "png" && value !== "svg") {
        throw new Error(`Invalid --format value: ${value}. Use png or svg.`);
      }
      format = value;
      index += 1;
      continue;
    }

    if (arg === "--concurrency") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --concurrency. Use auto or a positive integer.");
      }
      if (value.toLowerCase() === "auto") {
        concurrency = AUTO_CONCURRENCY;
        index += 1;
        continue;
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`Invalid --concurrency value: ${value}. Use auto or a positive integer.`);
      }
      concurrency = parsed;
      index += 1;
      continue;
    }

    if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (value !== "png" && value !== "svg") {
        throw new Error(`Invalid --format value: ${value}. Use png or svg.`);
      }
      format = value;
      continue;
    }

    if (arg.startsWith("--concurrency=")) {
      const value = arg.slice("--concurrency=".length);
      if (value.toLowerCase() === "auto") {
        concurrency = AUTO_CONCURRENCY;
        continue;
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`Invalid --concurrency value: ${value}. Use auto or a positive integer.`);
      }
      concurrency = parsed;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positional.push(arg);
  }

  if (positional.length === 0) {
    throw new Error("Missing input EPUB path.");
  }

  if (positional.length > 2) {
    throw new Error("Too many positional arguments. Usage: <input.epub> [output.epub] [--format png|svg] [--concurrency N|auto]");
  }

  const inputPath = path.resolve(positional[0]);
  const defaultOutput = inputPath.replace(/\.epub$/i, "") + ".kindle.epub";
  const outputPath = path.resolve(positional[1] ?? defaultOutput);

  return { inputPath, outputPath, format, concurrency };
}
