import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "../../../lib/prisma";
import { MONTH_MAP, TagCodeGenerator } from "./tagCodeGenerator";

const STATUS_ACTIVE = Number(process.env.STATUS_ACTIVE) || 1;
const STATUS_DELETED = Number(process.env.STATUS_DELETED) || 0;

const COMPANY_WEBSITE_URL = process.env.COMPANY_WEBSITE_URL || "https://yourcompany.com";
const QR_TAG_BASE_URL = process.env.QR_TAG_BASE_URL || `${COMPANY_WEBSITE_URL.replace(/\/$/, "")}/t/`;

const LOGO_PATH =
  process.env.QR_LOGO_PATH
    ? path.isAbsolute(process.env.QR_LOGO_PATH)
      ? process.env.QR_LOGO_PATH
      : path.join(process.cwd(), process.env.QR_LOGO_PATH)
    : path.join(process.cwd(), "public", "logo_new.png");

console.log("LOGO_PATH", LOGO_PATH)

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

function createTagGenerator(baseUrl?: string): TagCodeGenerator {
  return new TagCodeGenerator({ baseUrl: baseUrl || QR_TAG_BASE_URL });
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

  const logoSourcePath = fs.existsSync(QR_CENTER_LOGO_PATH) ? QR_CENTER_LOGO_PATH : LOGO_PATH;
  console.log("logoSourcePath", logoSourcePath)
  // ✅ Flatten logo onto white so QR dots never show through transparent parts
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

  // Rounded white badge behind logo with brand border.
  const knockoutSize = logoSize;
  const borderWidth = Math.max(3, Math.round(logoSize * 0.06));
  const knockoutSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${knockoutSize}" height="${knockoutSize}">
      <circle
        cx="${knockoutSize / 2}"
        cy="${knockoutSize / 2}"
        r="${(knockoutSize / 2) - borderWidth / 2}"
        fill="#FFFFFF"
        stroke="${QR_BRAND_COLOR}"
        stroke-width="${borderWidth}"
      />
    </svg>
  `;
  const knockout = await sharp(Buffer.from(knockoutSvg)).png().toBuffer();

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

async function buildSnapStyleCardPng(qrPayload: string, codeText: string): Promise<Buffer> {
  const cardWidth = 1200;
  const cardHeight = 560;

  const brandColor = "#235D61";
  const cardBg = "#efefef";

  // Left QR frame
  const frameX = 60;
  const frameY = 45;
  const frameSize = 420;
  const frameStroke = 12;

  const qrSize = 380;
  const qrX = frameX + Math.floor((frameSize - qrSize) / 2);
  const qrY = frameY + Math.floor((frameSize - qrSize) / 2);

  const codeX = frameX + Math.floor(frameSize / 2);
  const codeY = frameY + frameSize + 52;

  // Right panel geometry (logo auto-fits here)
  const rightPanelX = 520;
  const rightPanelY = 28;
  const rightPanelW = cardWidth - rightPanelX - 28;
  const rightPanelH = cardHeight - rightPanelY - 28;

  // Website link text under logo
  const rightLinkText = COMPANY_WEBSITE_URL.replace(/\/$/, "");
  const safeRightLink = rightLinkText.replace(/[<>&]/g, "");
  const rightLinkX = rightPanelX + Math.floor(rightPanelW / 2);

  const safeCode = String(codeText).replace(/[<>&]/g, "");

  const baseSvg = `
    <svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${cardWidth}" height="${cardHeight}" fill="${cardBg}" />

      <!-- QR frame -->
      <rect
        x="${frameX}" y="${frameY}" width="${frameSize}" height="${frameSize}"
        fill="#FFFFFF" stroke="${brandColor}" stroke-width="${frameStroke}"
      />

      <!-- Code under QR -->
      <text
        x="${codeX}" y="${codeY}" text-anchor="middle"
        fill="${brandColor}" font-size="42" font-family="Arial, sans-serif"
        font-weight="800" letter-spacing="2"
      >${safeCode}</text>

    </svg>
  `;

  const qrPng = await buildBrandedQrPng(qrPayload, qrSize, 2, 112, 72);

  let logoBuffer: Buffer | null = null;
  let logoLeft = rightPanelX;
  let logoTop = rightPanelY;
  let logoW = rightPanelW;
  let logoH = Math.floor(rightPanelH * 0.78);
  const linkFontSize = 30;
  const sectionGap = 20;

  try {
    const rawLogo = await fsp.readFile(LOGO_PATH);
    logoBuffer = await preprocessRightLogo(rawLogo, rightPanelW, Math.floor(rightPanelH * 0.78));
    const meta = await sharp(logoBuffer).metadata();
    logoW = meta.width || rightPanelW;
    logoH = meta.height || Math.floor(rightPanelH * 0.78);
    logoLeft = rightPanelX + Math.max(0, Math.floor((rightPanelW - logoW) / 2));
  } catch {
    logoBuffer = null;
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

  return sharp(Buffer.from(baseSvg))
    .composite(composites)
    .png()
    .toBuffer();
}




async function writeCardsToPdf(cards: Buffer[], outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 20 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const cols = 2;
    const rows = 2;
    const gap = 10;
    const margin = 20;
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const cardW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
    const cardH = (pageH - margin * 2 - gap * (rows - 1)) / rows;
    const cardsPerPage = cols * rows;

    cards.forEach((card, idx) => {
      if (idx > 0 && idx % cardsPerPage === 0) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 20 });
      }

      const slot = idx % cardsPerPage;
      const r = Math.floor(slot / cols);
      const c = slot % cols;
      const x = margin + c * (cardW + gap);
      const y = margin + r * (cardH + gap);
      doc.image(card, x, y, { fit: [cardW, cardH], align: "center", valign: "center" });
    });

    doc.end();
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
}

export const generateQrCode = async (req: Request, res: Response) => {
  try {
    const token = uuidv4();
    const qrUrl = `${COMPANY_WEBSITE_URL.replace(/\/$/, "")}/scan/${encodeURIComponent(token)}`;

    const finalPng = await buildBrandedQrPng(qrUrl);

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-QR-URL", qrUrl);
    res.setHeader("X-QR-TOKEN", token);

    return res.status(200).send(finalPng);
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({
      message: "Failed to generate QR",
      error: e?.message,
    });
  }
};

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

      const cards: Buffer[] = [];
      for (const tag of chunk) {
        cards.push(await buildSnapStyleCardPng(tag.qrPayload, tag.code));
      }

      const fileName = `${batch.batch.prefix}_part_${String(i + 1).padStart(3, "0")}_of_${String(totalPdfs).padStart(3, "0")}.pdf`;
      const outputPath = path.join(outputDir, fileName);
      await writeCardsToPdf(cards, outputPath);

      files.push({
        fileName,
        url: `${COMPANY_WEBSITE_URL.replace(/\/$/, "")}/qr-pdfs/${fileName}`,
        count: chunk.length,
      });
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

export const generateSingleTagCode = async (req: Request, res: Response) => {
  try {
    const { prefix, sequenceNum, seed, prime, baseUrl } = req.body || {};

    if (!prefix || sequenceNum === undefined || seed === undefined || prime === undefined) {
      return res.status(400).json({
        success: false,
        message: "prefix, sequenceNum, seed, prime are required",
      });
    }

    const generator = createTagGenerator(baseUrl);
    const result = generator.generateCode(
      String(prefix).toUpperCase(),
      Number(sequenceNum),
      Number(seed),
      Number(prime)
    );

    return res.status(200).json({
      success: true,
      message: "Tag code generated",
      data: result,
    });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed to generate code" });
  }
};

export const regenerateTagCode = async (req: Request, res: Response) => {
  try {
    const { prefix, sequenceNum, seed, prime, baseUrl } = req.body || {};

    if (!prefix || sequenceNum === undefined || seed === undefined || prime === undefined) {
      return res.status(400).json({
        success: false,
        message: "prefix, sequenceNum, seed, prime are required",
      });
    }

    const generator = createTagGenerator(baseUrl);
    const result = generator.regenerateCode(
      String(prefix).toUpperCase(),
      Number(sequenceNum),
      Number(seed),
      Number(prime)
    );

    return res.status(200).json({
      success: true,
      message: "Tag code regenerated",
      data: result,
    });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e?.message || "Failed to regenerate code" });
  }
};

export const parseTagCode = async (req: Request, res: Response) => {
  const { input, baseUrl } = req.body || {};
  if (!input) {
    return res.status(400).json({ success: false, message: "input is required" });
  }

  const generator = createTagGenerator(baseUrl);
  const parsed = generator.parseCode(String(input));

  return res.status(parsed.isValid ? 200 : 422).json({
    success: parsed.isValid,
    message: parsed.isValid ? "Tag code parsed" : "Invalid tag code",
    data: parsed,
  });
};

export const validateTagCode = async (req: Request, res: Response) => {
  const { input, baseUrl } = req.body || {};
  if (!input) {
    return res.status(400).json({ success: false, message: "input is required" });
  }

  const generator = createTagGenerator(baseUrl);
  const validation = generator.validateManualEntry(String(input));

  return res.status(validation.isValid ? 200 : 422).json({
    success: validation.isValid,
    message: validation.isValid ? "Valid tag code" : "Invalid tag code",
    data: validation,
  });
};

export const generateTagQrImage = async (req: Request, res: Response) => {
  try {
    const {
      code,
      codeCompact,
      prefix,
      sequenceNum,
      seed,
      prime,
      baseUrl,
      width,
      margin,
      logoSize,
    } = req.body || {};

    const generator = createTagGenerator(baseUrl);

    let payloadUrl = "";
    let resolvedCompactCode = "";

    if (code || codeCompact) {
      const parsed = generator.parseCode(String(code || codeCompact));
      if (!parsed.isValid || !parsed.codeCompact || !parsed.qrPayload) {
        return res.status(422).json({
          success: false,
          message: parsed.error || "Invalid code/codeCompact",
          data: parsed,
        });
      }
      payloadUrl = parsed.qrPayload;
      resolvedCompactCode = parsed.codeCompact;
    } else if (prefix && sequenceNum !== undefined && seed !== undefined && prime !== undefined) {
      const generated = generator.generateCode(
        String(prefix).toUpperCase(),
        Number(sequenceNum),
        Number(seed),
        Number(prime)
      );
      payloadUrl = generated.qrPayload;
      resolvedCompactCode = generated.codeCompact;
    } else {
      return res.status(400).json({
        success: false,
        message: "Provide either (code/codeCompact) OR (prefix, sequenceNum, seed, prime)",
      });
    }

    const finalPng = await buildBrandedQrPng(
      payloadUrl,
      width ? Number(width) : DEFAULT_QR_WIDTH,
      margin ? Number(margin) : DEFAULT_QR_MARGIN,
      logoSize ? Number(logoSize) : DEFAULT_LOGO_SIZE
    );

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-QR-URL", payloadUrl);
    res.setHeader("X-QR-CODE", resolvedCompactCode);

    return res.status(200).send(finalPng);
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: "Failed to generate tag QR image",
      error: e?.message,
    });
  }
};

export const getNextTagPrefix = async (req: Request, res: Response) => {
  try {
    const generator = createTagGenerator();
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const yearMonth = `${year}${MONTH_MAP[now.getMonth()]}`;

    const lastBatch = await prisma.tagBatch.findFirst({
      where: { yearMonth },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });

    const maxSeq = lastBatch?.sequence || 0;

    const nextPrefix = generator.generateNextPrefix(maxSeq, now);
    return res.status(200).json({
      success: true,
      message: "Next prefix generated",
      data: { yearMonth, lastSequence: maxSeq, nextPrefix },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Failed to generate next prefix" });
  }
};

export const getTagBatchByPrefix = async (req: Request, res: Response) => {
  try {
    const prefix = String(req.params.prefix || "").trim().toUpperCase();
    if (!/^\d{2}[A-L]\d{2}$/.test(prefix)) {
      return res.status(400).json({
        success: false,
        message: "Invalid prefix format. Expected YYMNN (example: 26B03).",
      });
    }

    const includeTags = String(req.query.includeTags || "true").toLowerCase() !== "false";
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 100)));
    const skip = (page - 1) * limit;

    const batch = await prisma.tagBatch.findUnique({
      where: { prefix },
      select: {
        id: true,
        prefix: true,
        yearMonth: true,
        sequence: true,
        quantity: true,
        notes: true,
        generatedAt: true,
        createdAt: true,
        _count: { select: { tags: true } },
      },
    });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Tag batch not found",
        data: null,
      });
    }

    const tags = includeTags
      ? await prisma.tag.findMany({
        where: { batchId: batch.id },
        orderBy: { sequence: "asc" },
        skip,
        take: limit,
        select: {
          sequence: true,
          code: true,
          codeCompact: true,
          qrPayload: true,
          isAssigned: true,
          assignedDog: true,
          assignedAt: true,
        },
      })
      : [];

    return res.status(200).json({
      success: true,
      message: "Tag batch fetched",
      data: {
        batch: {
          prefix: batch.prefix,
          yearMonth: batch.yearMonth,
          sequence: batch.sequence,
          quantity: batch.quantity,
          notes: batch.notes,
          generatedAt: batch.generatedAt,
          createdAt: batch.createdAt,
        },
        tags,
        pagination: includeTags
          ? {
            page,
            limit,
            total: batch._count.tags,
            totalPages: Math.max(1, Math.ceil(batch._count.tags / limit)),
          }
          : null,
      },
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Failed to fetch tag batch",
    });
  }
};

export const getTagByCodeCompact = async (req: Request, res: Response) => {
  try {
    const codeCompact = String(req.params.codeCompact || "").trim().toUpperCase();
    const parsed = createTagGenerator().parseCode(codeCompact);
    if (!parsed.isValid || !parsed.codeCompact) {
      return res.status(400).json({
        success: false,
        message: parsed.error || "Invalid codeCompact",
      });
    }

    const tag = await prisma.tag.findUnique({
      where: { codeCompact: parsed.codeCompact },
      select: {
        id: true,
        sequence: true,
        code: true,
        codeCompact: true,
        qrPayload: true,
        isAssigned: true,
        assignedDog: true,
        assignedAt: true,
        batch: {
          select: {
            id: true,
            prefix: true,
            yearMonth: true,
            sequence: true,
            quantity: true,
            batchSeed: true,
            primeMultiplier: true,
            notes: true,
            generatedAt: true,
          },
        },
      },
    });

    if (!tag) {
      return res.status(404).json({
        success: false,
        message: "Tag not found",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Tag fetched",
      data: [{
        tag: {
          id: tag.id,
          sequence: tag.sequence,
          code: tag.code,
          codeCompact: tag.codeCompact,
          qrPayload: tag.qrPayload,
          isAssigned: tag.isAssigned,
          assignedDog: tag.assignedDog,
          assignedAt: tag.assignedAt,
        },
        batch: tag.batch,
      }],
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e?.message || "Failed to fetch tag",
    });
  }
};

export const getScanInfo = async (req: Request, res: Response) => {
  const code = String(req.query.code || "");
  if (!code) return res.status(400).json({ message: "code required" });

  try {
    const dog = await prisma.dog.findUnique({
      where: { qrCode: code },
    });

    if (!dog) {
      return res.status(404).json({
        success: false,
        message: "Dog not found",
        data: [],
      });
    }

    return res.status(200).json({
      success: true,
      message: "Dog found",
      data: [dog],
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Failed to get scan info",
      data: [],
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
      message: "This dog already has a QR assigned and it cannot be changed",
      dogId: dog.id,
      dogUniqueId: dog.tempId,
      existingQrCode: dog.qrCode,
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
    message: "QR assigned successfully",
    dogId: dog!.id,
    dogUniqueId: dog!.tempId,
    qrCode: dog!.qrCode,
  });
};
