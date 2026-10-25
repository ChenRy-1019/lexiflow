/**
 * Build the bundled lexicon file.
 *
 * Usage:
 *   npm run lexicon:build
 *
 * The script turns the upstream ECDICT dataset into the compact JSON that the
 * application ships with. Everything it consumes is MIT licensed, which keeps
 * the project safe to redistribute — see `docs/DATA_SOURCES.md`.
 *
 * Two upstream files are used:
 *
 *   * `ecdict.csv` — the dictionary. Columns: word, phonetic, definition,
 *     translation, pos, collins, oxford, tag, bnc, frq, exchange, detail,
 *     audio.
 *   * `wordroot.txt` — roots and affixes with their meaning and example words.
 *
 * Both are downloaded into `data/_upstream` on first run and are not checked
 * into the repository.
 */

import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const UPSTREAM = resolve(ROOT, "data", "_upstream");
const OUTPUT = resolve(ROOT, "data", "lexicon.json");

const ECDICT_REPO = "https://raw.githubusercontent.com/skywind3000/ECDICT/master";

/**
 * Mirrors tried in order when the primary host is unreachable.
 *
 * `raw.githubusercontent.com` is sometimes blocked or rate limited on
 * networks that route through a proxy, so the script falls back to a few
 * well-known GitHub proxies before giving up.
 */
const ECDICT_MIRRORS = [
  ECDICT_REPO,
  "https://gh-proxy.com/https://raw.githubusercontent.com/skywind3000/ECDICT/master",
  "https://ghproxy.net/https://raw.githubusercontent.com/skywind3000/ECDICT/master",
  "https://ghfast.top/https://raw.githubusercontent.com/skywind3000/ECDICT/master",
];

/** Books are built from ECDICT tags. */
interface BookSpec {
  id: string;
  name: string;
  category: string;
  short: string;
  description: string;
  /** ECDICT `tag` column values that qualify a word for this book. */
  tags?: string[];
  /** Only include words whose frequency rank falls in this range. */
  frqRange?: [number, number];
  /** Only include words with at least this Collins star rating. */
  minCollins?: number;
  /** Only include multi-word phrases. */
  phraseOnly?: boolean;
  /** The book is filled from the root file rather than the dictionary. */
  rootsOnly?: boolean;
  /**
   * The book is filled from a CSV in `data/wordbooks` rather than from
   * ECDICT. The file has the columns 单词 / 释义 / 音标.
   */
  csvFile?: string;
}

/**
 * The wordbooks shipped with the app.
 *
 * The exam books are built from the `tag` column, which ECDICT fills from the
 * official syllabuses: `zk` is the CET-4/6 list, `cet4` and `cet6` the
 * separate exam lists, `ky` and `gk` the postgraduate ones, and `ielts`,
 * `toefl` and `gre` the international exams.
 *
 * The general books are built from the `frq` column, which holds each word's
 * rank in a corpus of contemporary English. Words with a rank of zero are not
 * in the corpus and are excluded.
 */
const BOOKS: BookSpec[] = [
  {
    id: "cet4",
    name: "大学英语四级词汇",
    category: "国内考试",
    short: "CET-4",
    description: "大学英语四级考试大纲要求掌握的核心词汇。",
    tags: ["zk", "cet4"],
  },
  {
    id: "cet6",
    name: "大学英语六级词汇",
    category: "国内考试",
    short: "CET-6",
    description: "大学英语六级考试大纲要求掌握的核心词汇。",
    tags: ["zk", "cet6"],
  },
  {
    id: "cet4core",
    name: "刘晓燕英语四级核心词汇",
    category: "国内考试",
    short: "CET-4 核心",
    description:
      "按主题分 10 个单元的核心词表，共 2327 词。内容整理自刘晓燕《英语四级核心词》，" +
      "版权归原作者所有，仅供个人学习；如需系统学习建议购买原书。",
    csvFile: "cet4-core.csv",
  },
  {
    id: "kaoyan",
    name: "考研英语词汇",
    category: "国内考试",
    short: "NPEE",
    description: "硕士研究生入学考试英语大纲词汇。",
    tags: ["ky", "gk"],
  },
  {
    id: "ielts",
    name: "雅思核心词汇",
    category: "出国考试",
    short: "IELTS",
    description: "雅思考试高频词汇，覆盖听力、阅读与口语场景。",
    tags: ["ielts"],
  },
  {
    id: "toefl",
    name: "托福核心词汇",
    category: "出国考试",
    short: "TOEFL",
    description: "托福考试高频词汇，侧重学术阅读与校园场景。",
    tags: ["toefl"],
  },
  {
    id: "gre",
    name: "GRE 核心词汇",
    category: "出国考试",
    short: "GRE",
    description: "GRE 考试高频词汇。",
    tags: ["gre"],
  },
  {
    id: "top2000",
    name: "最高频 2000 词",
    category: "通用词汇",
    short: "TOP 2K",
    description: "日常语言中最常使用的两千个单词，先掌握它们最划算。",
    frqRange: [1, 2000],
  },
  {
    id: "top5000",
    name: "高频 5000 词",
    category: "通用词汇",
    short: "TOP 5K",
    description: "按语料库词频排序的前五千词。",
    frqRange: [1, 5000],
  },
  {
    id: "top10000",
    name: "高频 10000 词",
    category: "通用词汇",
    short: "TOP 10K",
    description: "按语料库词频排序的前一万词，适合系统性扩充词汇量。",
    frqRange: [1, 10000],
  },
  {
    id: "roots",
    name: "词根词缀",
    category: "词法",
    short: "ROOTS",
    description: "常见词根与词缀，掌握后能推断大量生词含义。",
    rootsOnly: true,
  },
];

/** A row of the ECDICT CSV. */
interface EcdictRow {
  word: string;
  phonetic: string;
  definition: string;
  translation: string;
  pos: string;
  collins: number;
  oxford: number;
  tag: string;
  bnc: number;
  frq: number;
  exchange: string;
  detail: string;
  audio: string;
}

/** A root or affix from `wordroot.txt`. */
interface RootEntry {
  root: string;
  meaning: string;
  class: string;
  origin: string;
  example: string[];
}

/** One dictionary entry in the shipped lexicon. */
interface OutputEntry {
  id: string;
  word: string;
  meaning: string;
  pos: string;
  phonetic: string;
  example: string;
  exampleZh: string;
  phrase: boolean;
  etymology: string;
}

/**
 * Split a CSV line, honouring double-quoted fields.
 *
 * ECDICT quotes any field that contains a comma, so a naive split would break
 * every translation with several senses.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/** Parse the ECDICT tag column into a set of tags. */
function parseTags(value: string): Set<string> {
  return new Set(
    value
      .split(/\s+/)
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Map an ECDICT part-of-speech marker onto a short tag. */
function normalisePos(value: string): string {
  const raw = value.trim().toLowerCase().replace(/\.$/, "");
  const map: Record<string, string> = {
    n: "n.",
    noun: "n.",
    v: "v.",
    verb: "v.",
    vt: "vt.",
    vi: "vi.",
    adj: "adj.",
    a: "adj.",
    adjective: "adj.",
    adv: "adv.",
    adverb: "adv.",
    prep: "prep.",
    preposition: "prep.",
    conj: "conj.",
    conjunction: "conj.",
    pron: "pron.",
    pronoun: "pron.",
    num: "num.",
    numeral: "num.",
    int: "int.",
    interjection: "int.",
    aux: "aux.",
    modal: "modal v.",
    phrase: "词组",
    phr: "词组",
  };
  return map[raw] ?? "";
}

/**
 * Split the leading part-of-speech marker off a translation.
 *
 * ECDICT stores the part of speech inside the Chinese translation rather
 * than in the `pos` column, which is empty for most rows. A typical value
 * looks like `n. 能力, 才干\n[经] 能力, 才能`, so the marker is the first
 * token and the gloss is what follows it.
 */
function splitPosAndMeaning(translation: string): { pos: string; meaning: string } {
  const text = translation.replace(/\r/g, "").trim();
  if (!text) return { pos: "", meaning: "" };

  // The marker is only recognised at the very start of the text.
  const match = /^([a-zA-Z]{1,6}\.)\s*/.exec(text);
  if (match) {
    const pos = normalisePos(match[1]);
    if (pos) {
      const meaning = text.slice(match[0].length).trim();
      return { pos, meaning };
    }
  }
  return { pos: "", meaning: text };
}

/**
 * Turn a raw translation into a single-line gloss.
 *
 * ECDICT separates the senses of a word with escaped newlines — the file
 * literally contains the two characters `\` and `n` — so those have to be
 * turned into real line breaks before the senses can be folded together.
 */
function foldMeaning(raw: string): string {
  return raw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    // Drop the bracketed domain markers such as `[医]` and `[网络]`.
    .filter((line) => line.length > 0)
    .join("；")
    .replace(/；+/g, "；")
    .replace(/^；|；$/g, "")
    .trim();
}

/** Whether a headword is a multi-word phrase. */
function isPhrase(word: string): boolean {
  return word.trim().includes(" ");
}

/** Build a stable id from the book and the headword. */
function entryId(bookId: string, word: string): string {
  const slug = word
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${bookId}:${slug || "x"}`;
}

/**
 * Download a file if it is not already present.
 *
 * Node's `fetch` refuses to talk to hosts whose certificate is signed by a
 * corporate proxy's CA, which is common on locked-down networks. When that
 * happens the script falls back to PowerShell, which uses the machine's
 * certificate store and therefore succeeds.
 */
async function ensureUpstream(name: string): Promise<string> {
  if (!existsSync(UPSTREAM)) {
    mkdirSync(UPSTREAM, { recursive: true });
  }
  const target = resolve(UPSTREAM, name);
  if (existsSync(target) && statSync(target).size > 0) {
    console.log(`  · ${name} already present (${statSync(target).size} bytes)`);
    return target;
  }

  console.log(`  · downloading ${name} …`);
  const errors: string[] = [];

  for (const base of ECDICT_MIRRORS) {
    try {
      const response = await fetch(`${base}/${name}`, {
        signal: AbortSignal.timeout(600_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(target));
      console.log(`  · ${name} saved (${statSync(target).size} bytes)`);
      return target;
    } catch (error) {
      errors.push(`${base}: ${(error as Error).message}`);
      console.log(`  · ${base} failed: ${(error as Error).message}`);
    }
  }

  // Fall back to PowerShell, which trusts the system certificate store.
  console.log("  · falling back to PowerShell for the download …");
  for (const base of ECDICT_MIRRORS) {
    const ok = await downloadWithPowerShell(`${base}/${name}`, target);
    if (ok) {
      console.log(`  · ${name} saved (${statSync(target).size} bytes)`);
      return target;
    }
  }

  throw new Error(`cannot download ${name}:\n    ${errors.join("\n    ")}`);
}

/** Download a URL with PowerShell, honouring the system certificate store. */
async function downloadWithPowerShell(url: string, target: string): Promise<boolean> {
  const { spawn } = await import("node:child_process");
  const script = [
    "$ProgressPreference = 'SilentlyContinue';",
    `Invoke-WebRequest -Uri '${url.replace(/'/g, "''")}' -OutFile '${target.replace(/'/g, "''")}' -UseBasicParsing -TimeoutSec 900`,
  ].join(" ");

  return new Promise((resolve) => {
    const child = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { stdio: "ignore" },
    );
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0 && existsSync(target)));
  });
}

/** Read and index the root and affix file. */
async function loadRoots(): Promise<Map<string, RootEntry>> {
  const path = await ensureUpstream("wordroot.txt");
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, RootEntry>;

  const index = new Map<string, RootEntry>();
  for (const [key, entry] of Object.entries(parsed)) {
    const root = (entry.root || key).trim();
    if (!root) continue;
    index.set(root.toLowerCase(), {
      root,
      meaning: entry.meaning ?? "",
      class: entry.class ?? "root",
      origin: entry.origin ?? "",
      example: Array.isArray(entry.example) ? entry.example.slice(0, 6) : [],
    });
  }
  console.log(`  · indexed ${index.size} roots and affixes`);
  return index;
}

/**
 * Find the roots that a word is built from.
 *
 * The upstream file gives example words per root, so the most reliable way to
 * connect a word to its roots is to look the word up in those examples. The
 * stem is then checked against the word, because a root that merely happens
 * to appear in the example list is not necessarily part of *this* word.
 */
function findRoots(word: string, roots: Map<string, RootEntry>): RootEntry[] {
  const lower = word.toLowerCase();
  const hits: RootEntry[] = [];

  for (const entry of roots.values()) {
    // The word has to appear in the root's own example list.
    const listed = entry.example.some((example) => example.toLowerCase() === lower);
    if (!listed) continue;

    // At least one of the root's spellings has to be present in the word.
    const stems = entry.root
      .split(/[,/]/)
      .map((part) => part.trim().toLowerCase().replace(/[^a-z]/g, ""))
      .filter((stem) => stem.length >= 2);

    const matched = stems.some(
      (stem) =>
        lower.startsWith(stem) ||
        lower.endsWith(stem) ||
        (stem.length >= 4 && lower.includes(stem)),
    );
    if (!matched) continue;

    hits.push(entry);
  }

  return hits.slice(0, 3);
}

/** Format the roots of a word into the etymology field. */
function formatEtymology(word: string, roots: Map<string, RootEntry>): string {
  const hits = findRoots(word, roots);
  if (hits.length === 0) return "";
  return hits
    .map((hit) => {
      const label = hit.class === "affix" ? "词缀" : "词根";
      const origin = hit.origin ? `（${hit.origin}）` : "";
      return `${label} ${hit.root}${origin}：${hit.meaning}`;
    })
    .join("；");
}

/** The wordbooks, deduplicated by id. */
function uniqueBooks(): BookSpec[] {
  const seen = new Set<string>();
  const result: BookSpec[] = [];
  for (const book of BOOKS) {
    if (seen.has(book.id)) continue;
    seen.add(book.id);
    result.push(book);
  }
  return result;
}

/** Main build. */
async function main(): Promise<void> {
  console.log("LexiFlow · building the bundled lexicon");

  const books = uniqueBooks();
  const roots = await loadRoots();
  const csvPath = await ensureUpstream("ecdict.csv");

  const buckets = new Map<string, Map<string, OutputEntry>>();
  for (const book of books) {
    buckets.set(book.id, new Map());
  }

  const reader = createInterface({
    input: createReadStream(csvPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let header: string[] | null = null;
  let scanned = 0;
  let matched = 0;

  for await (const line of reader) {
    if (!header) {
      header = splitCsvLine(line).map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!line) continue;

    scanned += 1;
    const fields = splitCsvLine(line);
    const row: Partial<EcdictRow> = {};
    header.forEach((name, index) => {
      row[name as keyof EcdictRow] = fields[index] ?? "";
    });

    const word = (row.word ?? "").trim();
    const translation = (row.translation ?? "").trim();
    if (!word || !translation) continue;

    const tags = parseTags(row.tag ?? "");
    const frq = Number(row.frq ?? 0);
    const collins = Number(row.collins ?? 0);
    const phrase = isPhrase(word);
    const { pos, meaning: rawMeaning } = splitPosAndMeaning(translation);

    // The network-encyclopedia entries (`[网络] …`) and the cross-reference
    // entries are not useful for study, so they are skipped.
    if (rawMeaning.startsWith("[网络]") || rawMeaning.startsWith("[俚]")) continue;
    if (!rawMeaning) continue;

    for (const book of books) {
      const bucket = buckets.get(book.id)!;

      // The roots book is filled from the root file afterwards, and a
      // csv-backed book from its own file.
      if (book.rootsOnly) continue;
      if (book.csvFile) continue;

      if (book.phraseOnly && !phrase) continue;
      if (book.tags && book.tags.length > 0) {
        const wanted = book.tags.some((tag) => tags.has(tag));
        if (!wanted) continue;
      }
      if (book.frqRange) {
        const [low, high] = book.frqRange;
        if (frq < low || frq > high) continue;
      }
      if (book.minCollins && collins < book.minCollins) continue;

      const id = entryId(book.id, word);
      if (bucket.has(id)) continue;

      // The gloss may span several lines; fold them into one.
      const meaning = foldMeaning(rawMeaning);

      bucket.set(id, {
        id,
        word,
        meaning,
        pos,
        phonetic: (row.phonetic ?? "").replace(/^\/|\/$/g, "").trim(),
        example: "",
        exampleZh: "",
        phrase,
        etymology: "",
      });
      matched += 1;
    }
  }

  console.log(`  · scanned ${scanned} rows, matched ${matched} entries`);

  // Fill each csv-backed book from its file.
  for (const book of books) {
    if (!book.csvFile) continue;
    const bucket = buckets.get(book.id)!;
    const file = resolve(ROOT, "data", "wordbooks", book.csvFile);
    if (!existsSync(file)) {
      console.warn(`  ! ${book.csvFile} is missing, ${book.id} will be empty`);
      continue;
    }

    const rows = readFileSync(file, "utf-8").replace(/^\uFEFF/, "").split(/\r?\n/);
    // The first line is the header: 单词,释义,音标
    for (const line of rows.slice(1)) {
      if (!line.trim()) continue;
      const [word, meaning, phonetic] = splitCsvLine(line).map((cell) => cell.trim());
      if (!word || !meaning) continue;

      const id = entryId(book.id, word);
      if (bucket.has(id)) continue;

      // A leading part of speech marker stays in the gloss, which is how the
      // source writes it; the practice page shows the whole string.
      bucket.set(id, {
        id,
        word,
        meaning: foldMeaning(meaning),
        pos: "",
        phonetic: (phonetic ?? "").replace(/^\/|\/$/g, "").trim(),
        example: "",
        exampleZh: "",
        phrase: isPhrase(word),
        etymology: "",
      });
    }
    console.log(`  · ${book.id}: ${bucket.size} entries from ${book.csvFile}`);
  }

  // Fill the roots book from the root file.
  const rootsBucket = buckets.get("roots")!;
  for (const entry of roots.values()) {
    const id = entryId("roots", entry.root);
    if (rootsBucket.has(id)) continue;
    rootsBucket.set(id, {
      id,
      word: entry.root,
      meaning: entry.meaning,
      pos: entry.class === "affix" ? "词缀" : "词根",
      phonetic: "",
      example: entry.example.join(" / "),
      exampleZh: entry.origin,
      phrase: false,
      etymology: "",
    });
  }

  // Attach roots to the words that contain them.
  let withEtymology = 0;
  for (const bucket of buckets.values()) {
    for (const entry of bucket.values()) {
      if (entry.pos === "词根" || entry.pos === "词缀") continue;
      const etymology = formatEtymology(entry.word, roots);
      if (etymology) {
        entry.etymology = etymology;
        withEtymology += 1;
      }
    }
  }
  console.log(`  · attached etymology to ${withEtymology} entries`);

  // Assemble the output file.
  const outBooks: Record<string, OutputEntry[]> = {};
  const meta: Record<string, unknown> = {};
  let total = 0;

  for (const book of books) {
    // A csv-backed book keeps the order of its source file: the CET-4 core
    // list is grouped into ten units that build on each other, and sorting it
    // alphabetically would throw that structure away. Books drawn from ECDICT
    // are sorted, which reads better when browsing a dictionary.
    const values = [...buckets.get(book.id)!.values()];
    const entries = book.csvFile
      ? values
      : values.sort((a, b) => a.word.localeCompare(b.word));
    outBooks[book.id] = entries;
    total += entries.length;
    meta[book.id] = {
      id: book.id,
      name: book.name,
      category: book.category,
      short: book.short,
      description: book.description,
      total: entries.length,
    };
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      name: "ECDICT",
      url: "https://github.com/skywind3000/ECDICT",
      license: "MIT",
      sha256: sha256(readFileSync(csvPath)),
    },
    books: outBooks,
    meta,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(payload), "utf-8");
  console.log(`  · wrote ${OUTPUT} (${total} entries across ${books.length} books)`);
}

/** SHA-256 of a buffer, used to pin the upstream dataset. */
function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

main().catch((error) => {
  console.error("lexicon build failed:", error);
  process.exitCode = 1;
});
