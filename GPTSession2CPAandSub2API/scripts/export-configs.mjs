#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  EXPORT_TARGETS,
  buildTargetDocument,
  getTimestampToken,
  normalizeTimestamp,
  parseInputDocument,
  sanitizeFileToken,
} from '../src/converter.mjs';

const DEFAULT_OUT_DIR = 'exports';
const DEFAULT_TARGETS = EXPORT_TARGETS;

function printUsage() {
  console.log(`Usage:
  node scripts/export-configs.mjs <file-or-dir...> [--out <dir>] [--targets <list>] [--no-individual] [--replace]

Examples:
  node scripts/export-configs.mjs ../codex-oauth-automation-extension/data --out ./exports
  node scripts/export-configs.mjs /path/to/auths --out /path/to/generated-configs --targets cpa,sub2api,cockpit,9router

Outputs:
  <out>/cpa/accounts/<email-or-account>.cpa.json
  <out>/cpa/cpa-accounts.json
  <out>/sub2api/accounts/<email-or-account>.sub2api.json
  <out>/sub2api/sub2api-accounts.json
  <out>/cockpit/accounts/<email-or-account>.cockpit.json
  <out>/cockpit/cockpit-accounts.json
  <out>/9router/accounts/<email-or-account>.9router.json
  <out>/9router/9router-accounts.json
  <out>/manifest.json
`);
}

function parseArgs(argv) {
  const args = {
    inputs: [],
    outDir: DEFAULT_OUT_DIR,
    targets: DEFAULT_TARGETS,
    individual: true,
    mergeExisting: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--help' || item === '-h') {
      args.help = true;
    } else if (item === '--out' || item === '-o') {
      args.outDir = argv[++index];
    } else if (item === '--targets') {
      args.targets = parseTargets(argv[++index]);
    } else if (item === '--no-individual') {
      args.individual = false;
    } else if (item === '--replace') {
      args.mergeExisting = false;
    } else if (item.startsWith('--')) {
      throw new Error(`Unknown option: ${item}`);
    } else {
      args.inputs.push(item);
    }
  }

  return args;
}

function parseTargets(value) {
  const targets = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!targets.length) {
    throw new Error('Missing target list after --targets.');
  }

  const allowed = new Set(EXPORT_TARGETS);
  const invalid = targets.filter((target) => !allowed.has(target));
  if (invalid.length) {
    throw new Error(`Unsupported target(s): ${invalid.join(', ')}. Allowed: ${EXPORT_TARGETS.join(', ')}`);
  }

  return [...new Set(targets)];
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectJsonFiles(inputPath) {
  const stat = await fs.stat(inputPath);
  if (stat.isFile()) {
    return inputPath.toLowerCase().endsWith('.json') ? [inputPath] : [];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  const entries = await fs.readdir(inputPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }
    files.push(...await collectJsonFiles(path.join(inputPath, entry.name)));
  }
  return files;
}

function getDedupeKey(item) {
  return String(
    item.email
      || item.cpa?.account_id
      || item.sub2apiAccount?.credentials?.chatgpt_account_id
      || item.nineRouter?.id
      || item.name
      || `${item.sourceName}:${item.sourcePath}`,
  ).toLowerCase();
}

function dedupeConverted(items) {
  const byKey = new Map();
  for (const item of items) {
    byKey.set(getDedupeKey(item), item);
  }
  return [...byKey.values()];
}

async function convertFiles(files, now) {
  const converted = [];
  const skipped = [];

  for (const file of files) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      const result = parseInputDocument(parsed, file, now);
      converted.push(...result.converted);
      skipped.push(...result.skipped);
    } catch (error) {
      skipped.push({
        sourceName: file,
        path: '$',
        reason: error instanceof Error ? error.message : 'read failed',
      });
    }
  }

  return { converted, skipped };
}

async function readExistingTargetDocuments(targetDir, now) {
  const accountsDir = path.join(targetDir, 'accounts');
  if (!await pathExists(accountsDir)) {
    return [];
  }

  const files = await collectJsonFiles(accountsDir);
  const { converted } = await convertFiles(files, now);
  return converted;
}

function getAccountFileStem(item) {
  return sanitizeFileToken(
    item.email
      || item.name
      || item.cpa?.account_id
      || item.sub2apiAccount?.credentials?.chatgpt_account_id
      || item.nineRouter?.id
      || 'account',
  );
}

function getCombinedFileName(target) {
  return `${target}-accounts.json`;
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function exportTarget(target, converted, options) {
  const targetDir = path.join(options.outDir, target);
  const accountsDir = path.join(targetDir, 'accounts');
  const existing = options.mergeExisting
    ? await readExistingTargetDocuments(targetDir, options.now)
    : [];
  const allConverted = dedupeConverted([...existing, ...converted]);

  if (options.individual) {
    for (const item of converted) {
      const fileStem = getAccountFileStem(item);
      const document = buildTargetDocument(target, [item], options.now, { singleObjectWhenOne: true });
      await writeJson(path.join(accountsDir, `${fileStem}.${target}.json`), document);
    }
  }

  const combinedFile = path.join(targetDir, getCombinedFileName(target));
  await writeJson(combinedFile, buildTargetDocument(target, allConverted, options.now));

  return {
    target,
    output_dir: targetDir,
    combined_file: combinedFile,
    individual_dir: options.individual ? accountsDir : null,
    new_accounts: converted.length,
    total_accounts: allConverted.length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.inputs.length) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const now = new Date();
  const outDir = path.resolve(args.outDir);
  const inputFiles = [];
  for (const input of args.inputs) {
    inputFiles.push(...await collectJsonFiles(path.resolve(input)));
  }

  if (!inputFiles.length) {
    throw new Error('No JSON input files found.');
  }

  const { converted, skipped } = await convertFiles(inputFiles, now);
  const dedupedNew = dedupeConverted(converted);
  const targets = [];
  for (const target of args.targets) {
    targets.push(await exportTarget(target, dedupedNew, {
      outDir,
      individual: args.individual,
      mergeExisting: args.mergeExisting,
      now,
    }));
  }

  const manifestPath = path.join(outDir, 'manifest.json');
  await writeJson(manifestPath, {
    exported_at: normalizeTimestamp(now),
    output_dir: outDir,
    targets,
    input_files: inputFiles,
    new_accounts_raw: converted.length,
    new_accounts: dedupedNew.length,
    skipped,
    merge_existing: args.mergeExisting,
    run_id: getTimestampToken(now),
  });

  console.log(`Converted ${dedupedNew.length} account(s) from ${inputFiles.length} JSON file(s).`);
  for (const result of targets) {
    console.log(`${result.target}: ${result.combined_file}`);
  }
  if (skipped.length) {
    console.log(`Skipped ${skipped.length} item(s). See ${manifestPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
