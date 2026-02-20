import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export async function ensureFileExists(filePath: string): Promise<void> {
  try {
    await stat(filePath);
  } catch {
    throw new Error(`Input EPUB not found: ${filePath}`);
  }
}

export async function getAllFiles(root: string): Promise<string[]> {
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
