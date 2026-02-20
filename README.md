# EPUB MathML → PNG/SVG Converter (Kindle)

Converts MathML equations inside EPUB XHTML/HTML files into PNG images or inline SVG so formulas render on Kindle devices that do not support MathML.

## Quick Usage

Download a prebuilt binary from the GitHub Releases page:

- [https://github.com/hsnfirdaus/epub-mathml-converter/releases](https://github.com/hsnfirdaus/epub-mathml-converter/releases)

Then run:

```bash
./epub-mathml-converter <input.epub> [output.epub] [--format png|svg] [--concurrency N|auto]
```

Examples:

```bash
./epub-mathml-converter tes.epub
./epub-mathml-converter tes.epub tes-kindle.epub
./epub-mathml-converter tes.epub --format svg
./epub-mathml-converter tes.epub tes-kindle.svg.epub --format svg
./epub-mathml-converter tes.epub --format png --concurrency auto
./epub-mathml-converter tes.epub --format png --concurrency 4
```

If output is omitted, it writes to:

`<input-name>.kindle.epub`

`--format` defaults to `png`.

`--concurrency` controls how many XHTML files are processed at once (default: `auto`, based on CPU parallelism).

## From Source

### Requirements

- [Bun](https://bun.sh)

### Install

```bash
bun install
```

### Build Single Binary (Release)

```bash
bun run build:bin
```

This creates a standalone executable named `epub-mathml-converter`.

Run it directly:

```bash
./epub-mathml-converter <input.epub> [output.epub] [--format png|svg] [--concurrency N|auto]
```

### Script Usage (Without Compiling)

```bash
bun run src/index.ts <input.epub> [output.epub] [--format png|svg] [--concurrency N|auto]
```

## What it does

1. Unzips the EPUB to a temp folder.
	- Uses built-in cross-platform ZIP handling (`yauzl`/`yazl`), no external `zip`/`unzip` tools required.
2. Scans all `.xhtml`, `.html`, `.htm` files.
3. Converts each `<math>` node depending on format:
	- `png`: MathJax → SVG → PNG and injects `<img src="data:image/png;base64,...">`
	- `svg`: injects inline `<svg ...>`
4. Adds minimal CSS classes for inline/block math rendering.
5. Repackages EPUB with `mimetype` first and uncompressed (EPUB-compatible).

## Notes

- It preserves existing EPUB structure and assets.
- If a specific MathML snippet fails conversion, it is left unchanged.
- This codebase is Full AI Generated.