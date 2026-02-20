import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "./cli";
import { extractEpub, repackEpub } from "./epub";
import { ensureFileExists, getAllFiles } from "./fs-utils";
import { appendStylesIfMissingByFormat, convertMathInFileByFormat, createMathmlConverters } from "./mathml";

const XHTML_EXTENSIONS = new Set([".xhtml", ".html", ".htm"]);

async function runWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  worker: (item: TItem) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const result: TResult[] = new Array(items.length);
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      result[currentIndex] = await worker(items[currentIndex]);
    }
  });

  await Promise.all(runners);
  return result;
}

async function main() {
  const { inputPath, outputPath, format, concurrency } = parseArgs(process.argv);

  await ensureFileExists(inputPath);

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "epub-mathml-svg-"));
  const extractRoot = path.join(tempRoot, "book");

  let totalConverted = 0;
  let filesChanged = 0;

  try {
    await extractEpub(inputPath, extractRoot);

    const allFiles = await getAllFiles(extractRoot);
    const xhtmlFiles = allFiles.filter((filePath) => XHTML_EXTENSIONS.has(path.extname(filePath).toLowerCase()));

    const converters = createMathmlConverters();

    const conversionResults = await runWithConcurrency(xhtmlFiles, concurrency, async (filePath) => {
      const result = await convertMathInFileByFormat(filePath, format, converters);
      if (result.changed) {
        await appendStylesIfMissingByFormat(filePath, format);
      }
      return result;
    });

    for (const result of conversionResults) {
      if (!result.changed) {
        continue;
      }
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