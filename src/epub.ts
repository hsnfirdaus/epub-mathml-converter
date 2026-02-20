import { mkdir, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import yauzl from "yauzl";
import yazl from "yazl";
import { getAllFiles } from "./fs-utils";

function resolveArchiveEntryPath(root: string, entryName: string): string {
  const normalizedEntryName = entryName.replace(/\\/g, "/");
  const rootPath = path.resolve(root);
  const outputPath = path.resolve(rootPath, normalizedEntryName);

  if (outputPath !== rootPath && !outputPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error(`Unsafe archive entry path: ${entryName}`);
  }

  return outputPath;
}

function openZipFile(inputPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(inputPath, { lazyEntries: true, decodeStrings: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error("Failed to open zip file"));
        return;
      }
      resolve(zipFile);
    });
  });
}

function openEntryReadStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error(`Failed to read zip entry: ${entry.fileName}`));
        return;
      }
      resolve(stream);
    });
  });
}

export async function extractEpub(inputPath: string, extractRoot: string): Promise<void> {
  await mkdir(extractRoot, { recursive: true });
  const zipFile = await openZipFile(inputPath);

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      zipFile.close();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const processEntry = async (entry: yauzl.Entry) => {
      const destination = resolveArchiveEntryPath(extractRoot, entry.fileName);

      if (/\/$/.test(entry.fileName)) {
        await mkdir(destination, { recursive: true });
        return;
      }

      await mkdir(path.dirname(destination), { recursive: true });
      const readStream = await openEntryReadStream(zipFile, entry);
      await pipeline(readStream, createWriteStream(destination));
    };

    zipFile.on("error", (error) => finish(error));
    zipFile.on("end", () => finish());
    zipFile.on("entry", (entry) => {
      processEntry(entry)
        .then(() => {
          zipFile.readEntry();
        })
        .catch((error: unknown) => {
          const wrapped = error instanceof Error ? error : new Error(String(error));
          finish(wrapped);
        });
    });

    zipFile.readEntry();
  });
}

export async function repackEpub(extractedRoot: string, outputPath: string): Promise<void> {
  const mimetypePath = path.join(extractedRoot, "mimetype");

  await stat(mimetypePath).catch(() => {
    throw new Error(`EPUB is missing required mimetype file at ${mimetypePath}`);
  });

  const allFiles = await getAllFiles(extractedRoot);
  const otherFiles = allFiles
    .filter((filePath) => path.relative(extractedRoot, filePath) !== "mimetype")
    .sort((a, b) => a.localeCompare(b));

  await rm(outputPath, { force: true });

  const zipFile = new yazl.ZipFile();
  const outputStream = createWriteStream(outputPath);

  const completed = new Promise<void>((resolve, reject) => {
    outputStream.on("close", () => resolve());
    outputStream.on("error", reject);
    zipFile.outputStream.on("error", reject);
  });

  zipFile.outputStream.pipe(outputStream);

  zipFile.addFile(mimetypePath, "mimetype", { compress: false });

  for (const filePath of otherFiles) {
    const archivePath = path.relative(extractedRoot, filePath).split(path.sep).join("/");
    zipFile.addFile(filePath, archivePath, { compress: true });
  }

  zipFile.end();
  await completed;
}
