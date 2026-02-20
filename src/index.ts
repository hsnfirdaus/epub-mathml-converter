import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { MathML } from "mathjax-full/js/input/mathml.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { Resvg } from "@resvg/resvg-js";

type CliOptions = {
  inputPath: string;
  outputPath: string;
  format: OutputFormat;
};

type OutputFormat = "png" | "svg";

const XHTML_EXTENSIONS = new Set([".xhtml", ".html", ".htm"]);

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

function printHelp(): void {
  const command = getCommandName(process.argv);
  console.log(`Usage:
  ${command} <input.epub> [output.epub] [--format png|svg]

Examples:
  ${command} tes.epub
  ${command} tes.epub tes-kindle.epub
  ${command} tes.epub --format svg
  ${command} tes.epub tes-kindle.svg.epub --format svg

Notes:
  - Requires system commands: unzip, zip
  - --format defaults to png
  - png: replaces <math> with <img src="data:image/png;base64,...">
  - svg: replaces <math> with inline <svg>
`);
}

function parseArgs(argv: string[]): CliOptions {
  const args = getCliArgs(argv);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printHelp();
    process.exit(args.length === 0 ? 1 : 0);
  }

  let format: OutputFormat = "png";
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

    if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (value !== "png" && value !== "svg") {
        throw new Error(`Invalid --format value: ${value}. Use png or svg.`);
      }
      format = value;
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
    throw new Error("Too many positional arguments. Usage: <input.epub> [output.epub] [--format png|svg]");
  }

  const inputPath = path.resolve(positional[0]);
  const defaultOutput = inputPath.replace(/\.epub$/i, "") + ".kindle.epub";
  const outputPath = path.resolve(positional[1] ?? defaultOutput);

  return { inputPath, outputPath, format };
}

function runCommand(command: string, args: string[], cwd?: string): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.error) {
    throw new Error(`Failed to run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\n${stderr || stdout || "Unknown error"}`
    );
  }
}

async function ensureFileExists(filePath: string): Promise<void> {
  try {
    await stat(filePath);
  } catch {
    throw new Error(`Input EPUB not found: ${filePath}`);
  }
}

function ensureCommandExists(command: string): void {
  const checker = spawnSync("which", [command], {
    encoding: "utf8",
    stdio: "pipe"
  });

  if (checker.status !== 0) {
    throw new Error(`Required command not found in PATH: ${command}`);
  }
}

async function getAllFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getAllFiles(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function createMathmlSvgConverter() {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);

  const inputJax = new MathML();
  const outputJax = new SVG({ fontCache: "none" });
  const html = mathjax.document("", {
    InputJax: inputJax,
    OutputJax: outputJax
  });

  return (mathml: string, display: boolean): string => {
    const node = html.convert(mathml, { display });
    const output = adaptor.outerHTML(node);
    const svgMatch = output.match(/<svg[\s\S]*<\/svg>/i);
    return svgMatch ? svgMatch[0] : output;
  };
}

function createMathmlPngConverter(svgConverter: (mathml: string, display: boolean) => string) {
  return (mathml: string, display: boolean): string => {
    const svgMarkup = svgConverter(mathml, display);

    const resvg = new Resvg(svgMarkup, {
      fitTo: {
        mode: "zoom",
        value: 2
      }
    });
    const pngData = resvg.render();
    const pngBytes = pngData.asPng();
    return Buffer.from(pngBytes).toString("base64");
  };
}

function extractAltText(mathNodeXml: string): string | null {
  const annotationMatch = mathNodeXml.match(
    /<annotation[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>/i
  );

  if (!annotationMatch) {
    return null;
  }

  return annotationMatch[1]
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function escapeAttributeValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildImgTagFromBase64(base64Png: string, className: string, altText: string | null): string {
  const alt = escapeAttributeValue(altText ?? "math");
  return `<img class="${className}" src="data:image/png;base64,${base64Png}" alt="${alt}" />`;
}

function injectSvgAttributes(svg: string, className: string, altText: string | null): string {
  let updated = svg;

  if (/\sclass\s*=\s*"([^"]*)"/i.test(updated)) {
    updated = updated.replace(/\sclass\s*=\s*"([^"]*)"/i, (_m, existing) => {
      const normalized = `${existing} ${className}`.trim().replace(/\s+/g, " ");
      return ` class="${normalized}"`;
    });
  } else {
    updated = updated.replace(/^<svg\b/i, `<svg class="${className}"`);
  }

  if (!/\sxmlns\s*=\s*"http:\/\/www\.w3\.org\/2000\/svg"/i.test(updated)) {
    updated = updated.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  if (altText) {
    const escapedAlt = escapeAttributeValue(altText);
    if (!/\srole\s*=\s*"/i.test(updated)) {
      updated = updated.replace(/^<svg\b/i, '<svg role="img"');
    }
    if (!/\saria-label\s*=\s*"/i.test(updated)) {
      updated = updated.replace(/^<svg\b/i, `<svg aria-label="${escapedAlt}"`);
    }
  }

  return updated;
}

async function convertMathInFileByFormat(
  filePath: string,
  format: OutputFormat,
  converters: {
    svg: (mathml: string, display: boolean) => string;
    png: (mathml: string, display: boolean) => string;
  }
) {
  const original = await readFile(filePath, "utf8");
  const mathPattern = /<math\b[\s\S]*?<\/math>/gi;
  if (!mathPattern.test(original)) {
    return { changed: false, count: 0 };
  }
  mathPattern.lastIndex = 0;

  let convertedCount = 0;

  const replaced = original.replace(mathPattern, (mathXml) => {
    const displayMatch = mathXml.match(/\sdisplay\s*=\s*(["'])(.*?)\1/i);
    const display = (displayMatch?.[2] ?? "inline").toLowerCase() === "block";
    const altText = extractAltText(mathXml);

    try {
      if (format === "svg") {
        const svgMarkup = converters.svg(mathXml, display);
        if (!/^<svg\b/i.test(svgMarkup.trim())) {
          return mathXml;
        }
        const className = `math-svg ${display ? "math-svg-block" : "math-svg-inline"}`;
        convertedCount += 1;
        return injectSvgAttributes(svgMarkup, className, altText);
      }

      const pngBase64 = converters.png(mathXml, display);
      if (!pngBase64 || /[^A-Za-z0-9+/=]/.test(pngBase64)) {
        return mathXml;
      }
      const className = `math-png ${display ? "math-png-block" : "math-png-inline"}`;
      convertedCount += 1;
      return buildImgTagFromBase64(pngBase64, className, altText);
    } catch {
      return mathXml;
    }
  });

  if (convertedCount === 0) {
    return { changed: false, count: 0 };
  }

  await writeFile(filePath, replaced, "utf8");
  return { changed: true, count: convertedCount };
}

async function appendStylesIfMissingByFormat(xhtmlFilePath: string, format: OutputFormat): Promise<void> {
  const content = await readFile(xhtmlFilePath, "utf8");
  const inlineClass = format === "svg" ? "math-svg-inline" : "math-png-inline";
  const blockClass = format === "svg" ? "math-svg-block" : "math-png-block";
  if (content.includes(inlineClass) && content.includes(blockClass)) {
    return;
  }

  if (!content.includes("</head>")) {
    return;
  }

  const styleTag =
    format === "svg"
      ? `<style type="text/css">.math-svg-inline{vertical-align:middle;display:inline-block;max-width:100%;}.math-svg-block{display:block;margin:0.8em auto;max-width:100%;}</style>`
      : `<style type="text/css">.math-png-inline{vertical-align:middle;display:inline-block;max-width:100%;}.math-png-block{display:block;margin:0.8em auto;max-width:100%;}</style>`;
  const updated = content.replace("</head>", `${styleTag}</head>`);
  await writeFile(xhtmlFilePath, updated, "utf8");
}

async function repackEpub(extractedRoot: string, outputPath: string): Promise<void> {
  const mimetypePath = path.join(extractedRoot, "mimetype");

  await stat(mimetypePath).catch(() => {
    throw new Error(`EPUB is missing required mimetype file at ${mimetypePath}`);
  });

  await rm(outputPath, { force: true });

  runCommand("zip", ["-X0q", outputPath, "mimetype"], extractedRoot);
  runCommand("zip", ["-Xr9q", outputPath, ".", "-x", "mimetype"], extractedRoot);
}

async function main() {
  const { inputPath, outputPath, format } = parseArgs(process.argv);

  await ensureFileExists(inputPath);
  ensureCommandExists("unzip");
  ensureCommandExists("zip");

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "epub-mathml-svg-"));
  const extractRoot = path.join(tempRoot, "book");

  let totalConverted = 0;
  let filesChanged = 0;

  try {
    runCommand("unzip", ["-q", inputPath, "-d", extractRoot]);

    const allFiles = await getAllFiles(extractRoot);
    const xhtmlFiles = allFiles.filter((filePath) => XHTML_EXTENSIONS.has(path.extname(filePath).toLowerCase()));

    const svgConverter = createMathmlSvgConverter();
    const pngConverter = createMathmlPngConverter(svgConverter);

    for (const filePath of xhtmlFiles) {
      const result = await convertMathInFileByFormat(filePath, format, {
        svg: svgConverter,
        png: pngConverter
      });
      if (!result.changed) {
        continue;
      }

      await appendStylesIfMissingByFormat(filePath, format);
      filesChanged += 1;
      totalConverted += result.count;
    }

    await repackEpub(extractRoot, outputPath);

    console.log(`Done. Converted ${totalConverted} MathML nodes in ${filesChanged} file(s) using ${format}.`);
    console.log(`Output: ${outputPath}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Conversion failed: ${message}`);
  process.exit(1);
});