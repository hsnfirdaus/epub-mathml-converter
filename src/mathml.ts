import { readFile, writeFile } from "node:fs/promises";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { MathML } from "mathjax-full/js/input/mathml.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { Resvg } from "@resvg/resvg-js";
import { OutputFormat } from "./types";

type Converters = {
  svg: (mathml: string, display: boolean) => string;
  png: (mathml: string, display: boolean) => string;
};

export function createMathmlConverters(): Converters {
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);

  const inputJax = new MathML();
  const outputJax = new SVG({ fontCache: "none" });
  const html = mathjax.document("", {
    InputJax: inputJax,
    OutputJax: outputJax
  });

  const svgConverter = (mathml: string, display: boolean): string => {
    const node = html.convert(mathml, { display });
    const output = adaptor.outerHTML(node);
    const svgMatch = output.match(/<svg[\s\S]*<\/svg>/i);
    return svgMatch ? svgMatch[0] : output;
  };

  const pngConverter = (mathml: string, display: boolean): string => {
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

  return {
    svg: svgConverter,
    png: pngConverter
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

export async function convertMathInFileByFormat(
  filePath: string,
  format: OutputFormat,
  converters: Converters
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

export async function appendStylesIfMissingByFormat(
  xhtmlFilePath: string,
  format: OutputFormat
): Promise<void> {
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
