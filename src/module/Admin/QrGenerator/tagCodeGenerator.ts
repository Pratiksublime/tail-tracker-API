import { randomInt } from "crypto";

export const SAFE_CHARS = "A2C3D4E6F7G9HJKMNPQRTUVWXYZ";
export const BASE = SAFE_CHARS.length; // 27

export const PRIME_POOL = [
  547_979, 611_953, 648_391, 700_001, 736_487,
  793_517, 812_377, 856_189, 901_841, 953_467,
  1_003_001, 1_048_573, 1_100_023, 1_234_577, 1_300_021,
  1_425_173, 1_507_379, 1_612_009, 1_700_029, 1_800_017,
] as const;

export const MONTH_MAP = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const;

const PART2_OFFSET = 300_000;
const CODE_SPACE = Math.pow(BASE, 4);

export interface TagCodeGeneratorConfig {
  baseUrl?: string;
}

export interface TagCodeResult {
  sequence: number;
  code: string;
  codeCompact: string;
  qrPayload: string;
}

export interface BatchCreateOptions {
  quantity: number;
  prefix?: string;
  prefixSequence?: number;
  notes?: string;
}

export interface BatchResult {
  batch: {
    prefix: string;
    quantity: number;
    seed: number;
    prime: number;
    notes: string;
    generatedAt: string;
  };
  tags: TagCodeResult[];
  summary: {
    prefix: string;
    quantity: number;
    firstCode: string;
    lastCode: string;
    sampleCodes: string[];
  };
}

export interface ParsedCodeResult {
  isValid: boolean;
  prefix?: string;
  part1?: string;
  part2?: string;
  code?: string;
  codeCompact?: string;
  qrPayload?: string;
  error?: string;
  raw?: string;
}

function scramble(sequenceNum: number, seed: number, prime: number): string {
  const seq = BigInt(sequenceNum);
  const p = BigInt(prime);
  const s = BigInt(seed);
  const space = BigInt(CODE_SPACE);

  let scrambled = Number(((seq * p) + s) % space);
  if (scrambled < 0) scrambled += CODE_SPACE;

  let code = "";
  for (let i = 0; i < 4; i++) {
    code = SAFE_CHARS[scrambled % BASE] + code;
    scrambled = Math.floor(scrambled / BASE);
  }

  return code;
}

export class TagCodeGenerator {
  private readonly baseUrl: string;

  constructor(config: TagCodeGeneratorConfig = {}) {
    this.baseUrl = config.baseUrl || "https://yourdomain.com/t/";
  }

  generatePrefix(sequence: number, date = new Date()): string {
    const year = date.getFullYear().toString().slice(-2);
    const month = MONTH_MAP[date.getMonth()] ?? MONTH_MAP[0];
    const seq = String(sequence).padStart(2, "0");
    return `${year}${month}${seq}`;
  }

  generateNextPrefix(lastSeqForMonth: number, date = new Date()): string {
    const nextSeq = (lastSeqForMonth || 0) + 1;
    const year = date.getFullYear().toString().slice(-2);
    const month = MONTH_MAP[date.getMonth()] ?? MONTH_MAP[0];

    if (nextSeq > 99) {
      throw new Error(`Maximum 99 batches per month reached for ${year}${month}.`);
    }

    return this.generatePrefix(nextSeq, date);
  }

  generateSeed(): number {
    return randomInt(100_000, 1_000_000);
  }

  pickPrime(): number {
    const idx = randomInt(0, PRIME_POOL.length);
    return PRIME_POOL[idx];
  }

  generateCode(prefix: string, sequenceNum: number, seed: number, prime: number): TagCodeResult {
    if (sequenceNum < 1) {
      throw new Error("Sequence number must be >= 1");
    }

    const part1 = scramble(sequenceNum, seed, prime);
    const part2 = scramble(sequenceNum + PART2_OFFSET, seed, prime);

    const code = `${prefix}-${part1}-${part2}`;
    const codeCompact = `${prefix}${part1}${part2}`;
    const qrPayload = `${this.baseUrl}${codeCompact}`;

    return { sequence: sequenceNum, code, codeCompact, qrPayload };
  }

  regenerateCode(prefix: string, sequenceNum: number, seed: number, prime: number): TagCodeResult {
    return this.generateCode(prefix, sequenceNum, seed, prime);
  }

  createBatch(options: BatchCreateOptions): BatchResult {
    const { quantity, prefix, prefixSequence = 1, notes = "" } = options;

    if (!quantity || quantity < 1) {
      throw new Error("Quantity must be at least 1");
    }
    if (quantity > 500_000) {
      throw new Error("Maximum batch size is 500,000");
    }
    if (quantity > CODE_SPACE) {
      throw new Error(`Quantity ${quantity} exceeds maximum unique codes per batch (${CODE_SPACE}). Split into multiple batches.`);
    }

    const batchPrefix = prefix || this.generatePrefix(prefixSequence);
    const batchSeed = this.generateSeed();
    const batchPrime = this.pickPrime();

    const tags: TagCodeResult[] = [];
    for (let seq = 1; seq <= quantity; seq++) {
      tags.push(this.generateCode(batchPrefix, seq, batchSeed, batchPrime));
    }

    const codeSet = new Set(tags.map((t) => t.code));
    if (codeSet.size !== quantity) {
      throw new Error(
        `CRITICAL: Duplicate codes detected! Generated ${quantity} but only ${codeSet.size} unique. Do not use this batch.`
      );
    }

    return {
      batch: {
        prefix: batchPrefix,
        quantity,
        seed: batchSeed,
        prime: batchPrime,
        notes,
        generatedAt: new Date().toISOString(),
      },
      tags,
      summary: {
        prefix: batchPrefix,
        quantity,
        firstCode: tags[0].code,
        lastCode: tags[tags.length - 1].code,
        sampleCodes: tags.slice(0, 5).map((t) => t.code),
      },
    };
  }

  parseCode(input: string): ParsedCodeResult {
    let cleaned = input.trim().toUpperCase();

    if (cleaned.includes("/T/")) {
      cleaned = cleaned.split("/T/").pop() || "";
    } else if (cleaned.includes("/t/")) {
      cleaned = cleaned.split("/t/").pop() || "";
    }

    cleaned = cleaned.replace(/-/g, "");

    if (cleaned.length !== 13) {
      return {
        isValid: false,
        error: `Invalid code length: expected 13 characters, got ${cleaned.length}`,
        raw: input,
      };
    }

    const prefix = cleaned.substring(0, 5);
    const part1 = cleaned.substring(5, 9);
    const part2 = cleaned.substring(9, 13);

    const prefixRegex = /^[0-9]{2}[A-L][0-9]{2}$/;
    if (!prefixRegex.test(prefix)) {
      return {
        isValid: false,
        error: `Invalid prefix format: "${prefix}"`,
        raw: input,
      };
    }

    const safeRegex = new RegExp(`^[${SAFE_CHARS}]{4}$`);
    if (!safeRegex.test(part1) || !safeRegex.test(part2)) {
      return {
        isValid: false,
        error: `Code contains invalid characters. Only these are allowed: ${SAFE_CHARS}`,
        raw: input,
      };
    }

    const code = `${prefix}-${part1}-${part2}`;
    const codeCompact = `${prefix}${part1}${part2}`;

    return {
      isValid: true,
      prefix,
      part1,
      part2,
      code,
      codeCompact,
      qrPayload: `${this.baseUrl}${codeCompact}`,
    };
  }

  validateManualEntry(input: string): ParsedCodeResult {
    return this.parseCode(input);
  }
}
