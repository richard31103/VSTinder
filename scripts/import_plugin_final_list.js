#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  input: "Plugin_Final_List.txt",
  target: "simple/data.js",
  mode: "similar",
  report: "import_report_plugin_final.json",
  dryRun: false
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = {
    input: args.input || DEFAULTS.input,
    target: args.target || DEFAULTS.target,
    mode: args.mode || DEFAULTS.mode,
    report: args.report || DEFAULTS.report,
    dryRun: Boolean(args.dryRun)
  };

  if (!["exact", "similar"].includes(options.mode)) {
    throw new Error(`Unsupported --mode "${options.mode}". Use "exact" or "similar".`);
  }

  const cwd = process.cwd();
  const inputPath = path.resolve(cwd, options.input);
  const targetPath = path.resolve(cwd, options.target);
  const reportPath = path.resolve(cwd, options.report);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Target data file not found: ${targetPath}`);
  }

  const listText = fs.readFileSync(inputPath, "utf8");
  const lines = listText.split(/\r?\n/g);
  const incoming = parseIncoming(lines);

  const plugins = loadPluginsFromDataJs(targetPath);
  const existingBeforeCount = plugins.length;
  const usedIds = new Set(plugins.map((item) => String(item.id || "").trim().toLowerCase()).filter(Boolean));

  const strictIndex = new Map();
  const looseIndex = new Map();
  let preexistingStrictDuplicates = 0;
  let preexistingLooseDuplicates = 0;

  for (const item of plugins) {
    const name = String(item && item.name || "");
    const strictKey = normalizeStrictName(name);
    const looseKey = normalizeLooseName(name);

    if (strictKey) {
      if (strictIndex.has(strictKey)) {
        preexistingStrictDuplicates += 1;
      } else {
        strictIndex.set(strictKey, {
          id: String(item.id || ""),
          name
        });
      }
    }

    if (looseKey) {
      if (looseIndex.has(looseKey)) {
        preexistingLooseDuplicates += 1;
      } else {
        looseIndex.set(looseKey, {
          id: String(item.id || ""),
          name
        });
      }
    }
  }

  const added = [];
  const skipped = [];

  for (const row of incoming.parsed) {
    const strictKey = normalizeStrictName(row.name);
    const looseKey = normalizeLooseName(row.name);

    if (!strictKey || !looseKey) {
      skipped.push({
        lineNumber: row.lineNumber,
        vendor: row.vendor,
        name: row.name,
        reason: "invalid_name",
        matchedName: "",
        matchedId: ""
      });
      continue;
    }

    const strictMatch = strictIndex.get(strictKey);
    if (strictMatch) {
      skipped.push({
        lineNumber: row.lineNumber,
        vendor: row.vendor,
        name: row.name,
        reason: "exact",
        matchedName: strictMatch.name,
        matchedId: strictMatch.id
      });
      continue;
    }

    if (options.mode === "similar") {
      const looseMatch = looseIndex.get(looseKey);
      if (looseMatch) {
        skipped.push({
          lineNumber: row.lineNumber,
          vendor: row.vendor,
          name: row.name,
          reason: "similar",
          matchedName: looseMatch.name,
          matchedId: looseMatch.id
        });
        continue;
      }
    }

    const id = generateUniqueId(row.name, usedIds);
    const entry = {
      id,
      name: row.name,
      category: "Misc",
      vendor: row.vendor,
      purpose: "",
      features: []
    };

    plugins.push(entry);
    added.push({
      lineNumber: row.lineNumber,
      id: entry.id,
      name: entry.name,
      vendor: entry.vendor
    });

    strictIndex.set(strictKey, { id: entry.id, name: entry.name });
    looseIndex.set(looseKey, { id: entry.id, name: entry.name });
  }

  const skippedExact = skipped.filter((item) => item.reason === "exact").length;
  const skippedSimilar = skipped.filter((item) => item.reason === "similar").length;
  const skippedInvalidName = skipped.filter((item) => item.reason === "invalid_name").length;

  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.mode,
    dryRun: options.dryRun,
    input: toPosixPath(path.relative(cwd, inputPath)),
    target: toPosixPath(path.relative(cwd, targetPath)),
    totals: {
      existingBefore: existingBeforeCount,
      finalCount: plugins.length,
      linesRead: lines.length,
      linesNonEmpty: incoming.nonEmptyCount,
      parsed: incoming.parsed.length,
      invalidLineCount: incoming.invalid.length,
      added: added.length,
      skipped_exact: skippedExact,
      skipped_similar: skippedSimilar,
      skipped_invalid_name: skippedInvalidName,
      skipped_total: skipped.length
    },
    preexistingDuplicates: {
      strict: preexistingStrictDuplicates,
      loose: preexistingLooseDuplicates
    },
    added,
    skipped,
    invalidLines: incoming.invalid
  };

  const expectedTotal = added.length + skipped.length;
  if (expectedTotal !== incoming.parsed.length) {
    throw new Error(`Count mismatch: parsed=${incoming.parsed.length}, added+skipped=${expectedTotal}`);
  }

  if (!options.dryRun) {
    const output = `window.VSTINDER_PLUGINS = ${JSON.stringify(plugins, null, 2)};\n`;
    fs.writeFileSync(targetPath, output, "utf8");
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`Mode: ${options.mode}${options.dryRun ? " (dry-run)" : ""}`);
  console.log(`Parsed: ${incoming.parsed.length}`);
  console.log(`Added: ${added.length}`);
  console.log(`Skipped exact: ${skippedExact}`);
  console.log(`Skipped similar: ${skippedSimilar}`);
  console.log(`Skipped invalid-name: ${skippedInvalidName}`);
  console.log(`Invalid lines: ${incoming.invalid.length}`);
  console.log(`Final total: ${plugins.length}`);
  console.log(`Report: ${reportPath}`);
  if (options.dryRun) {
    console.log("Target file unchanged.");
  } else {
    console.log(`Updated: ${targetPath}`);
  }
}

function parseArgs(argv) {
  const out = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    if (key === "dry-run") {
      out.dryRun = true;
      continue;
    }

    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    out[key] = value;
    i += 1;
  }

  return out;
}

function parseIncoming(lines) {
  const parsed = [];
  const invalid = [];
  let nonEmptyCount = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const raw = String(lines[i] || "");
    const line = raw.trim();
    if (!line) continue;
    nonEmptyCount += 1;

    const splitToken = " - ";
    const index = line.indexOf(splitToken);
    if (index <= 0 || index >= line.length - splitToken.length) {
      invalid.push({ lineNumber, raw: line });
      continue;
    }

    const vendor = line.slice(0, index).trim();
    const name = line.slice(index + splitToken.length).trim();

    if (!vendor || !name) {
      invalid.push({ lineNumber, raw: line });
      continue;
    }

    parsed.push({ lineNumber, vendor, name });
  }

  return {
    parsed,
    invalid,
    nonEmptyCount
  };
}

function loadPluginsFromDataJs(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const match = raw.match(/^\s*window\.VSTINDER_PLUGINS\s*=\s*([\s\S]*?)\s*;\s*$/);
  if (!match) {
    throw new Error(`Cannot parse plugin array from ${filePath}`);
  }

  const parsed = JSON.parse(match[1]);
  if (!Array.isArray(parsed)) {
    throw new Error(`Parsed target is not an array: ${filePath}`);
  }
  return parsed;
}

function normalizeStrictName(input) {
  const raw = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  return raw
    .replace(/\s*(?:[-_])?\s*(?:\(?\s*(?:x64|x86|64[\s-]*bit|32[\s-]*bit)\s*\)?)\s*$/i, "")
    .trim();
}

function normalizeLooseName(input) {
  return normalizeStrictName(input).replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function generateUniqueId(name, usedIds) {
  const base = toSlug(name) || "plugin";
  let candidate = base;
  let i = 2;

  while (usedIds.has(candidate)) {
    candidate = `${base}-${i}`;
    i += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

function toSlug(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

try {
  main();
} catch (error) {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
}
