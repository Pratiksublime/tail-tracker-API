import { Prisma } from "@prisma/client";
import { execFile } from "child_process";
import { Request, Response } from "express";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import sharp from "sharp";
import { prisma } from "../../../lib/prisma";
import { MONTH_MAP, TagCodeGenerator } from "./tagCodeGenerator";

const STATUS_ACTIVE = Number(process.env.STATUS_ACTIVE) || 1;
const STATUS_DELETED = Number(process.env.STATUS_DELETED) || 0;

const COMPANY_WEBSITE_URL = process.env.COMPANY_WEBSITE_URL || "https://yourcompany.com";

const LOGO_PATH =
  process.env.QR_LOGO_PATH
    ? path.isAbsolute(process.env.QR_LOGO_PATH)
      ? process.env.QR_LOGO_PATH
      : path.join(process.cwd(), process.env.QR_LOGO_PATH)
    : path.join(process.cwd(), "public", "logo_new.png");

const QR_CENTER_LOGO_PATH =
  process.env.QR_CENTER_LOGO_PATH
    ? path.isAbsolute(process.env.QR_CENTER_LOGO_PATH)
      ? process.env.QR_CENTER_LOGO_PATH
      : path.join(process.cwd(), process.env.QR_CENTER_LOGO_PATH)
    : path.join(process.cwd(), "public", "tailLogo.svg");

const DEFAULT_QR_WIDTH = 400;
const DEFAULT_QR_MARGIN = 2;
const DEFAULT_LOGO_SIZE = 80;
const MAX_QR_PER_PDF = 100;
const QR_BRAND_COLOR = "#235D61";
const QR_RENDER_CONCURRENCY = Math.max(1, Number(process.env.QR_RENDER_CONCURRENCY || 4));
const PDF_PAGE_MARGIN = 20;
const PDF_GRID_GAP = 10;
const PDF_GRID_COLS = 2;
const PDF_GRID_ROWS = 2;
const A4_LANDSCAPE_WIDTH_PT = 841.89;

// function cmToPt(cm: number): number {
//   return (cm / 2.54) * 72;
// }

function cmToPt(cm: number) {
  return (cm / 2.54) * 72;
}
function inToPt(inches: number) {
  return inches * 72;
}

function qrPxForPrintedSize(
  desiredQrPt: number,
  printedCardPt: number,
  cardHeightPx: number
) {
  return Math.round((desiredQrPt / printedCardPt) * cardHeightPx);
}

function getQrRenderPxForTargetPrintedHeight(targetCm: number, cardWidthPx: number): number {
  const cardWidthPt =
    (A4_LANDSCAPE_WIDTH_PT - PDF_PAGE_MARGIN * 2 - PDF_GRID_GAP * (PDF_GRID_COLS - 1)) / PDF_GRID_COLS;
  const scaleToPdf = cardWidthPt / cardWidthPx;
  const targetPt = cmToPt(targetCm);
  return Math.max(1, Math.round(targetPt / scaleToPdf));
}

function createZipFromFiles(zipPath: string, files: string[], workingDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.platform === "win32") {
      const pathsArg = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(", ");
      const command = `Compress-Archive -Path ${pathsArg} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
      execFile(
        "powershell.exe",
        ["-NoProfile", "-Command", command],
        { cwd: workingDir },
        (error) => (error ? reject(error) : resolve())
      );
      return;
    }

    // Linux/macOS fallback: requires `zip` binary to be present.
    execFile(
      "zip",
      ["-j", "-q", zipPath, ...files],
      { cwd: workingDir },
      (error) => (error ? reject(error) : resolve())
    );
  });
}

function createTagGenerator(baseUrl?: string): TagCodeGenerator {
  return new TagCodeGenerator({ baseUrl: baseUrl });
}

function splitPrefix(prefix: string) {
  const match = /^(\d{2}[A-L])(\d{2})$/.exec(prefix);
  if (!match) {
    throw new Error("Invalid prefix format. Expected YYMNN (example: 26B03).");
  }

  return {
    yearMonth: match[1],
    sequence: Number(match[2]),
  };
}

type CenterQrAssets = { logo: Buffer; knockout: Buffer };
const centerQrAssetsCache = new Map<string, Promise<CenterQrAssets>>();
let rightLogoCache:
  | {
    key: string;
    buffer: Buffer;
    width: number;
    height: number;
  }
  | null = null;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = new Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

async function getCenterQrAssets(logoSize: number, innerLogoSize: number): Promise<CenterQrAssets> {
  const logoSourcePath = fs.existsSync(QR_CENTER_LOGO_PATH) ? QR_CENTER_LOGO_PATH : LOGO_PATH;
  const key = `${logoSourcePath}|${logoSize}|${innerLogoSize}`;

  if (!centerQrAssetsCache.has(key)) {
    centerQrAssetsCache.set(
      key,
      (async () => {
        const logoRaw = await sharp(logoSourcePath)
          .resize(innerLogoSize, innerLogoSize, { fit: "contain" })
          .ensureAlpha()
          .png()
          .toBuffer();

        const logoMaskSvg = `
          <svg xmlns="http://www.w3.org/2000/svg" width="${innerLogoSize}" height="${innerLogoSize}">
            <circle cx="${innerLogoSize / 2}" cy="${innerLogoSize / 2}" r="${(innerLogoSize / 2) - 1}" fill="#FFFFFF"/>
          </svg>
        `;
        const logoMask = await sharp(Buffer.from(logoMaskSvg)).png().toBuffer();
        const logo = await sharp(logoRaw)
          .composite([{ input: logoMask, blend: "dest-in" }])
          .png()
          .toBuffer();

        const borderWidth = Math.max(3, Math.round(logoSize * 0.06));
        const knockoutSvg = `
          <svg xmlns="http://www.w3.org/2000/svg" width="${logoSize}" height="${logoSize}">
            <circle
              cx="${logoSize / 2}"
              cy="${logoSize / 2}"
              r="${(logoSize / 2) - borderWidth / 2}"
              fill="#FFFFFF"
              stroke="${QR_BRAND_COLOR}"
              stroke-width="${borderWidth}"
            />
          </svg>
        `;
        const knockout = await sharp(Buffer.from(knockoutSvg)).png().toBuffer();

        return { logo, knockout };
      })()
    );
  }

  return centerQrAssetsCache.get(key)!;
}


async function buildBrandedQrPng(
  qrText: string,
  width = DEFAULT_QR_WIDTH,
  margin = DEFAULT_QR_MARGIN,
  logoSize = DEFAULT_LOGO_SIZE,
  innerLogoSize = logoSize
) {
  const qrObj = QRCode.create(qrText, { errorCorrectionLevel: "H" });
  const moduleCount = qrObj.modules.size;
  const quiet = Math.max(2, margin);
  const totalModules = moduleCount + quiet * 2;
  const moduleSize = width / totalModules;
  const dotRadius = moduleSize * 0.36;

  const finderAt = [
    { row: 0, col: 0 },
    { row: 0, col: moduleCount - 7 },
    { row: moduleCount - 7, col: 0 },
  ];

  const inFinder = (r: number, c: number) =>
    finderAt.some((f) => r >= f.row && r < f.row + 7 && c >= f.col && c < f.col + 7);

  const getDark = (r: number, c: number) => qrObj.modules.get(r, c);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 ${width} ${width}">`;
  svg += `<rect width="${width}" height="${width}" fill="#FFFFFF"/>`;

  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (!getDark(r, c) || inFinder(r, c)) continue;
      const cx = (quiet + c + 0.5) * moduleSize;
      const cy = (quiet + r + 0.5) * moduleSize;
      svg += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${dotRadius.toFixed(2)}" fill="${QR_BRAND_COLOR}"/>`;
    }
  }

  finderAt.forEach(({ row, col }) => {
    const x = (quiet + col) * moduleSize;
    const y = (quiet + row) * moduleSize;
    const s = 7 * moduleSize;
    const outerRadius = moduleSize * 0.8;
    const innerOffset = 2 * moduleSize;
    const innerSize = 3 * moduleSize;
    const innerRadius = moduleSize * 0.5;
    const ringStroke = moduleSize * 0.85;

    svg += `<rect x="${(x + moduleSize * 0.45).toFixed(2)}" y="${(y + moduleSize * 0.45).toFixed(2)}" width="${(s - moduleSize * 0.9).toFixed(2)}" height="${(s - moduleSize * 0.9).toFixed(2)}" rx="${outerRadius.toFixed(2)}" fill="none" stroke="${QR_BRAND_COLOR}" stroke-width="${ringStroke.toFixed(2)}"/>`;
    svg += `<rect x="${(x + innerOffset).toFixed(2)}" y="${(y + innerOffset).toFixed(2)}" width="${innerSize.toFixed(2)}" height="${innerSize.toFixed(2)}" rx="${innerRadius.toFixed(2)}" fill="${QR_BRAND_COLOR}"/>`;
  });

  svg += `</svg>`;
  const qrPng = await sharp(Buffer.from(svg)).png().toBuffer();

  const { logo, knockout } = await getCenterQrAssets(logoSize, innerLogoSize);

  return sharp(qrPng)
    .composite([
      { input: knockout, gravity: "center" }, // covers dots
      { input: logo, gravity: "center" },     // logo sits on clean white
    ])
    .png()
    .toBuffer();
}

async function preprocessRightLogo(rawLogo: Buffer, targetW: number, targetH: number): Promise<Buffer> {
  return sharp(rawLogo, { limitInputPixels: false })
    .ensureAlpha()
    .trim({ threshold: 8 })
    .resize(targetW, targetH, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function getRightLogoForPanel(targetW: number, targetH: number): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  try {
    const stat = await fsp.stat(LOGO_PATH);
    const key = `${LOGO_PATH}|${stat.mtimeMs}|${targetW}|${targetH}`;
    if (rightLogoCache && rightLogoCache.key === key) {
      return {
        buffer: rightLogoCache.buffer,
        width: rightLogoCache.width,
        height: rightLogoCache.height,
      };
    }

    const rawLogo = await fsp.readFile(LOGO_PATH);
    const buffer = await preprocessRightLogo(rawLogo, targetW, targetH);
    const meta = await sharp(buffer).metadata();
    const width = meta.width || targetW;
    const height = meta.height || targetH;

    rightLogoCache = { key, buffer, width, height };
    return { buffer, width, height };
  } catch {
    return null;
  }
}


export async function buildSnapStyleCardPng(
  qrPayload: string,
  codeText: string,
  linkText?: string
): Promise<Buffer> {
  const cardWidth = 1200;   // if you still want wider, set 1350 etc.
  const cardHeight = 560;

  // Must match writeCardsToPdf() scaling:
  const printedCardPt = cmToPt(2.5); // card prints 2.5cm tall

  // QR printed target (pick one)
  const desiredQrPt = cmToPt(2.0);
  // const desiredQrPt = inToPt(1.0);

  const brandColor = "#235D61";
  const cardBg = "#efefef";

  // QR frame geometry
  const frameX = 60;
  const frameSize = 420;
  const frameStroke = 12;

  // ✅ Center the QR frame vertically (equal top & bottom)
  const frameY = Math.floor((cardHeight - frameSize) / 2);

  const safeCodeDigits = String(codeText).replace(/[<>&]/g, "").replace(/\D/g, "");
  const safeCode = safeCodeDigits.slice(-8).padStart(8, "0");

  // ✅ Reserve "safe code gutter" between QR and logo to prevent overlap
  const safeGutterW = 115;  // more = more breathing room
  const qrToLogoGap = 28;   // spacing after gutter before logo area starts

  // ✅ Right panel starts AFTER the QR + gutter (prevents overlap)
  const rightPanelX = frameX + frameSize + safeGutterW + qrToLogoGap;
  const rightPanelY = 28;
  const rightPanelW = cardWidth - rightPanelX - 28;
  const rightPanelH = cardHeight - rightPanelY - 28;

  // ✅ Safe code placed in the center of that gutter
  const sideCodeFontSize = 44;
  const sideCodeY = frameY + Math.floor(frameSize / 2);

  // Put code in the middle of the gutter (slightly biased toward QR if desired)
  const rightCodeX = frameX + frameSize + Math.floor(safeGutterW / 2);

  // Direction:
  //  90  -> reads top-to-bottom
  // -90  -> reads bottom-to-top
  const rightRotate = 90;

  // ✅ Increase QR size inside frame by reducing padding
  let qrRenderSize = qrPxForPrintedSize(desiredQrPt, printedCardPt, cardHeight);

  const framePadding = 10; // smaller padding => bigger QR (try 8..16)
  const maxInsideFrame = frameSize - framePadding;
  qrRenderSize = Math.min(qrRenderSize, maxInsideFrame);

  // ✅ QR centered inside frame
  const qrX = frameX + Math.floor((frameSize - qrRenderSize) / 2);
  const qrY = frameY + Math.floor((frameSize - qrRenderSize) / 2);

  // Build QR PNG (ensure your buildBrandedQrPng uses nearest-neighbor if it resizes)
  const qrPng = await buildBrandedQrPng(qrPayload, qrRenderSize, 2, 112, 72);

  // Website link text under logo
  const rightLinkText = String(linkText || COMPANY_WEBSITE_URL).replace(/\/$/, "");
  const safeRightLink = rightLinkText.replace(/[<>&]/g, "");
  const rightLinkX = rightPanelX + Math.floor(rightPanelW / 2);

  // Base SVG: background, right-side safe code, QR frame
  const baseSvg = `
    <svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${cardWidth}" height="${cardHeight}" fill="${cardBg}" />

      <!-- Right rotated safe code (in reserved gutter) -->
      <text
        x="${rightCodeX}" y="${sideCodeY}"
        text-anchor="middle"
        dominant-baseline="middle"
        fill="${brandColor}"
        font-size="${sideCodeFontSize}"
        font-family="Arial, sans-serif"
        font-weight="800"
        letter-spacing="2"
        transform="rotate(${rightRotate} ${rightCodeX} ${sideCodeY})"
      >${safeCode}</text>

      <!-- QR frame -->
      <rect
        x="${frameX}" y="${frameY}" width="${frameSize}" height="${frameSize}"
        fill="#FFFFFF" stroke="${brandColor}" stroke-width="${frameStroke}"
      />
    </svg>
  `;

  // --- Right logo layout ---
  let logoBuffer: Buffer | null = null;
  let logoLeft = rightPanelX;
  let logoTop = rightPanelY;
  let logoW = rightPanelW;
  let logoH = Math.floor(rightPanelH * 0.78);

  const linkFontSize = 30;
  const sectionGap = 20;

  const rightLogo = await getRightLogoForPanel(rightPanelW, Math.floor(rightPanelH * 0.78));
  if (rightLogo) {
    logoBuffer = rightLogo.buffer;
    logoW = rightLogo.width;
    logoH = rightLogo.height;
    logoLeft = rightPanelX + Math.max(0, Math.floor((rightPanelW - logoW) / 2));
  }

  const rightContentH = logoH + sectionGap + linkFontSize;
  const rightContentTop = rightPanelY + Math.max(0, Math.floor((rightPanelH - rightContentH) / 2));
  logoTop = rightContentTop;

  const linkY = Math.min(cardHeight - 16, rightContentTop + logoH + sectionGap + linkFontSize - 4);

  const overlaySvg = `
    <svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg">
      <text
        x="${rightLinkX}" y="${linkY}" text-anchor="middle"
        fill="${brandColor}" font-size="${linkFontSize}" font-family="Arial, sans-serif"
        font-weight="700"
      >${safeRightLink}</text>
    </svg>
  `;
  const overlayPng = await sharp(Buffer.from(overlaySvg)).png().toBuffer();

  const composites: sharp.OverlayOptions[] = [
    { input: qrPng, top: qrY, left: qrX },
    { input: overlayPng, top: 0, left: 0 },
  ];
  if (logoBuffer) composites.push({ input: logoBuffer, top: logoTop, left: logoLeft });

  return sharp(Buffer.from(baseSvg)).composite(composites).png().toBuffer();
}

// -----------------------------------------------------------------------------
// PDF WRITER (unchanged except shown fully)
// Ensures card printed height is 2.5cm; width auto by aspect ratio.
// -----------------------------------------------------------------------------
export async function writeCardsToPdf(cards: Buffer[], outputPath: string): Promise<void> {
  await new Promise<void>(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: PDF_PAGE_MARGIN });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      const margin = PDF_PAGE_MARGIN;
      const gap = PDF_GRID_GAP;

      const pageW = doc.page.width;
      const pageH = doc.page.height;

      // ✅ fixed printed height (2.5 cm)
      const targetH = cmToPt(2.5);

      const meta = await sharp(cards[0]).metadata();
      if (!meta.width || !meta.height) throw new Error("Unable to read card image dimensions");
      const aspect = meta.width / meta.height;

      // ✅ auto width from aspect ratio
      const targetW = targetH * aspect;

      let x = margin;
      let y = margin;

      const maxX = pageW - margin;
      const maxY = pageH - margin;

      for (let i = 0; i < cards.length; i++) {
        // wrap to next row
        if (x + targetW > maxX) {
          x = margin;
          y += targetH + gap;
        }

        // new page if needed
        if (y + targetH > maxY) {
          doc.addPage({ size: "A4", layout: "landscape", margin: PDF_PAGE_MARGIN });
          x = margin;
          y = margin;
        }

        // ✅ print at fixed height; width follows aspect ratio
        doc.image(cards[i], x, y, { height: targetH });

        x += targetW + gap;
      }

      doc.end();
      stream.on("finish", () => resolve());
      stream.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
}



async function getPngSize(card: Buffer): Promise<{ w: number; h: number }> {
  const meta = await sharp(card).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Unable to read image dimensions");
  }
  return { w: meta.width, h: meta.height };
}


export const createTagBatch = async (req: Request, res: Response) => {
  try {
    const {
      quantity,
      prefix,
      prefixSequence,
      notes,
      baseUrl,
      includeSecrets = true,
      persistBatch = true,
    } = req.body || {};


    const parsedQty = Number(quantity);
    if (!parsedQty || Number.isNaN(parsedQty)) {
      return res.status(400).json({ success: false, message: "quantity (number) is required" });
    }

    const generator = createTagGenerator(baseUrl);
    let resolvedPrefix: string | undefined =
      typeof prefix === "string" && prefix.trim() ? prefix.trim().toUpperCase() : undefined;

    if (!resolvedPrefix && prefixSequence !== undefined) {
      resolvedPrefix = generator.generatePrefix(Number(prefixSequence));
    }

    if (!resolvedPrefix) {
      const now = new Date();
      const year = now.getFullYear().toString().slice(-2);
      const yearMonth = `${year}${MONTH_MAP[now.getMonth()]}`;

      const lastBatch = await prisma.tagBatch.findFirst({
        where: { yearMonth },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });

      resolvedPrefix = generator.generateNextPrefix(lastBatch?.sequence || 0, now);
    }

    splitPrefix(resolvedPrefix);

    const batch = generator.createBatch({
      quantity: parsedQty,
      prefix: resolvedPrefix,
      prefixSequence: prefixSequence !== undefined ? Number(prefixSequence) : undefined,
      notes: typeof notes === "string" ? notes : "",
    });

    if (persistBatch) {
      const { yearMonth, sequence } = splitPrefix(batch.batch.prefix);

      await prisma.$transaction(async (tx) => {
        const createdBatch = await tx.tagBatch.create({
          data: {
            prefix: batch.batch.prefix,
            yearMonth,
            sequence,
            quantity: batch.batch.quantity,
            batchSeed: batch.batch.seed,
            primeMultiplier: batch.batch.prime,
            notes: batch.batch.notes || null,
            generatedAt: new Date(batch.batch.generatedAt),
          },
          select: { id: true },
        });

        const chunkSize = 5_000;
        for (let i = 0; i < batch.tags.length; i += chunkSize) {
          const chunk = batch.tags.slice(i, i + chunkSize);
          await tx.tag.createMany({
            data: chunk.map((tag) => ({
              batchId: createdBatch.id,
              sequence: tag.sequence,
              code: tag.code,
              codeCompact: tag.codeCompact,
              qrPayload: tag.qrPayload,
            })),
          });
        }
      });
    }

    const responseBatch = includeSecrets
      ? batch.batch
      : {
        prefix: batch.batch.prefix,
        quantity: batch.batch.quantity,
        notes: batch.batch.notes,
        generatedAt: batch.batch.generatedAt,
      };

    return res.status(200).json({
      success: true,
      message: "Tag batch generated successfully",
      data: {
        batch: responseBatch,
        tags: batch.tags,
        summary: batch.summary,
      },
    });
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Batch prefix or tag code already exists. Retry with a new prefix.",
      });
    }
    return res.status(400).json({ success: false, message: e?.message || "Failed to generate tag batch" });
  }
};

export const generateBulkTagPdf = async (req: Request, res: Response) => {
  try {
    const {
      quantity,
      prefix,
      prefixSequence,
      notes,
      baseUrl,
      persistBatch = true,
      download = false,
    } = req.body || {};

    const parsedQty = Number(quantity);
    if (!parsedQty || Number.isNaN(parsedQty) || parsedQty < 1) {
      return res.status(400).json({
        success: false,
        message: "quantity (number >= 1) is required",
      });
    }
    if (parsedQty > 500_000) {
      return res.status(400).json({
        success: false,
        message: "Maximum quantity is 500,000",
      });
    }

    const generator = createTagGenerator(baseUrl);
    let resolvedPrefix: string | undefined =
      typeof prefix === "string" && prefix.trim() ? prefix.trim().toUpperCase() : undefined;

    if (!resolvedPrefix && prefixSequence !== undefined) {
      resolvedPrefix = generator.generatePrefix(Number(prefixSequence));
    }

    if (!resolvedPrefix) {
      const now = new Date();
      const year = now.getFullYear().toString().slice(-2);
      const yearMonth = `${year}${MONTH_MAP[now.getMonth()]}`;
      const lastBatch = await prisma.tagBatch.findFirst({
        where: { yearMonth },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      resolvedPrefix = generator.generateNextPrefix(lastBatch?.sequence || 0, now);
    }

    splitPrefix(resolvedPrefix);

    const batch = generator.createBatch({
      quantity: parsedQty,
      prefix: resolvedPrefix,
      prefixSequence: prefixSequence !== undefined ? Number(prefixSequence) : undefined,
      notes: typeof notes === "string" ? notes : "",
    });

    if (persistBatch) {
      const { yearMonth, sequence } = splitPrefix(batch.batch.prefix);
      await prisma.$transaction(async (tx) => {
        const createdBatch = await tx.tagBatch.create({
          data: {
            prefix: batch.batch.prefix,
            yearMonth,
            sequence,
            quantity: batch.batch.quantity,
            batchSeed: batch.batch.seed,
            primeMultiplier: batch.batch.prime,
            notes: batch.batch.notes || null,
            generatedAt: new Date(batch.batch.generatedAt),
          },
          select: { id: true },
        });

        const chunkSize = 5_000;
        for (let i = 0; i < batch.tags.length; i += chunkSize) {
          const chunk = batch.tags.slice(i, i + chunkSize);
          await tx.tag.createMany({
            data: chunk.map((tag) => ({
              batchId: createdBatch.id,
              sequence: tag.sequence,
              code: tag.code,
              codeCompact: tag.codeCompact,
              qrPayload: tag.qrPayload,
            })),
          });
        }
      });
    }

    const perPdf = MAX_QR_PER_PDF;
    const outputDir = path.join(process.cwd(), "public", "qr-pdfs");
    await fsp.mkdir(outputDir, { recursive: true });

    const totalTags = batch.tags.length;
    const totalPdfs = Math.ceil(totalTags / perPdf);
    const files: Array<{ fileName: string; url: string; count: number }> = [];

    for (let i = 0; i < totalPdfs; i++) {
      const start = i * perPdf;
      const end = Math.min(start + perPdf, totalTags);
      const chunk = batch.tags.slice(start, end);

      const cards = await mapWithConcurrency(
        chunk,
        QR_RENDER_CONCURRENCY,
        async (tag) => buildSnapStyleCardPng(tag.qrPayload, tag.code, baseUrl)
      );

      const fileName = `${batch.batch.prefix}_part_${String(i + 1).padStart(3, "0")}_of_${String(totalPdfs).padStart(3, "0")}.pdf`;
      const outputPath = path.join(outputDir, fileName);
      await writeCardsToPdf(cards, outputPath);

      files.push({
        fileName,
        url: `${COMPANY_WEBSITE_URL.replace(/\/$/, "")}/qr-pdfs/${fileName}`,
        count: chunk.length,
      });
    }

    // Optional direct download response for frontend (single PDF or ZIP for multiple PDFs)
    if (download) {
      if (parsedQty <= perPdf) {
        const single = files[0];
        const downloadPath = path.join(outputDir, single.fileName);
        return res.download(downloadPath, single.fileName);
      }

      const zipName = `${batch.batch.prefix}_all_parts_${new Date().getTime()}.zip`;
      const zipPath = path.join(outputDir, zipName);
      const absolutePdfPaths = files.map((f) => path.join(outputDir, f.fileName));
      await createZipFromFiles(zipPath, absolutePdfPaths, outputDir);
      res.download(zipPath, zipName, async () => {
        try {
          await fsp.unlink(zipPath);
        } catch {
          // no-op: cleanup best effort
        }
      });
      return;
    }

    return res.status(200).json({
      success: true,
      message: "Bulk QR PDFs generated successfully",
      data: {
        batch: {
          prefix: batch.batch.prefix,
          quantity: batch.batch.quantity,
          generatedAt: batch.batch.generatedAt,
        },
        pdf: {
          maxPerPdf: perPdf,
          totalPdfs,
          files,
        },
      },
    });
  } catch (e: any) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Batch prefix or tag code already exists. Retry with a new prefix.",
      });
    }
    return res.status(400).json({
      success: false,
      message: e?.message || "Failed to generate bulk QR PDFs",
    });
  }
};

export const fetchTag = async (req: Request, res: Response) => {
  try {
    const prefix = String(req.query.prefix || "").trim().toUpperCase();
    const codeCompact = String(req.query.codeCompact || "").trim().toUpperCase();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 100)));
    const skip = (page - 1) * limit;

    const where: Prisma.TagWhereInput = {};

    const [total, tags] = await Promise.all([
      prisma.tag.count({ where }),
      prisma.tag.findMany({
        where,
        orderBy: { id: "desc" },
        skip,
        take: limit,
        select: {
          sequence: true,
          code: true,
          codeCompact: true,
          qrPayload: true,
        },
      }),
    ]);

    const imageBase = `${req.protocol}://${req.get("host")}${req.baseUrl}`;
    const data = tags.map((tag) => ({
      sequence: tag.sequence,
      code: tag.code,
      codeCompact: tag.codeCompact,
      qrPayload: tag.qrPayload,
      qrImageUrl: `${imageBase}/tag/image/${encodeURIComponent(tag.codeCompact)}`,
    }));

    return res.status(200).json({
      success: true,
      message: "Tags fetched successfully",
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Failed to fetch tags",
    });
  }
};


export const assignScannedCodeToDog = async (req: Request, res: Response) => {
  const code = String(req.body.code || "");
  const dogId = Number(req.body.dogId);

  if (!code) return res.status(400).json({ message: "code required" });
  if (!dogId || Number.isNaN(dogId)) return res.status(400).json({ message: "dogId required" });

  const alreadyUsed = await prisma.dog.findUnique({
    where: { qrCode: code },
    select: { id: true, tempId: true },
  });
  if (alreadyUsed) {
    return res.status(409).json({
      message: "This QR code is already assigned to another dog",
      assignedDog: { dogId: alreadyUsed.id, dogUniqueId: alreadyUsed.tempId },
    });
  }

  const updated = await prisma.dog.updateMany({
    where: { id: dogId, qrCode: null, status: STATUS_ACTIVE },
    data: { qrCode: code, qrAssignedAt: new Date() },
  });

  if (updated.count === 0) {
    const dog = await prisma.dog.findUnique({
      where: { id: dogId },
      select: { id: true, tempId: true, qrCode: true, status: true },
    });

    if (!dog || dog.status === STATUS_DELETED) return res.status(404).json({ message: "Dog not found" });

    return res.status(409).json({
      success: false,
      message: "This dog already has a QR assigned and it cannot be changed",
      data: [
        {
          dogId: dog.id,
          dogUniqueId: dog.tempId,
          existingQrCode: dog.qrCode,
        }
      ]
    });
  }

  const dog = await prisma.dog.findUnique({
    where: { id: dogId },
    select: { id: true, tempId: true, qrCode: true },
  });

  const parsed = createTagGenerator().parseCode(code);
  const normalized = parsed.isValid ? parsed.codeCompact : code;
  await prisma.tag.updateMany({
    where: { codeCompact: normalized },
    data: { isAssigned: true, assignedDog: dogId, assignedAt: new Date() },
  });

  return res.status(200).json({
    success: true,
    message: "QR assigned successfully",
    data: [
      {
        dogId: dog!.id,
        dogUniqueId: dog!.tempId,
        qrCode: dog!.qrCode,
      }
    ]
  });
};
