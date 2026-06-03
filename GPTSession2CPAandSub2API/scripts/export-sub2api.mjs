#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  buildSub2apiDocument,
  getTimestampToken,
  normalizeTimestamp,
  parseInputDocument,
  sanitizeFileToken,
} from '../src/converter.mjs';

const DEFAULT_OUT_DIR = 'exports/sub2api';

function printUsage() {
  console.log(`Usage:
  node scripts/export-sub2api.mjs <file-or-dir...> [--out <dir>] [--combined-name <name>] [--no-individual]

Examples:
  node scripts/export-sub2api.mjs ../AutoTeam-F/auths --out ./exports/sub2api
  node scripts/export-sub2api.mjs /path/to/new-auth.json --out /path/to/sub2api-ready

Outputs:
  <out>/accounts/<email-or-account>.sub2api.json     one-account import document
  <out>/<combined-name>                              combined sub2api import document
  <out>/manifest.json                                export summary
`);
}

function parseArgs(argv) {
  const args = {
    inputs: [],
    outDir: DEFAULT_OUT_DIR,
    combinedName: 'sub2api-accounts.json',
    individual: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--help' || item === '-h') {
      args.help = true;
    } else if (item === '--out' || item === '-o') {
      args.outDir = argv[++index];
    } else if (item === '--combined-name') {
      args.combinedName = argv[++index];
    } else if (item === '--no-individual') {
      args.individual = false;
    } else if (item.startsWith('--')) {
      throw new Error(`Unknown option: ${item}`);
    } else {
      args.inputs.push(item);
    }
  }

  return args;
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

function dedupeConverted(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = item.email
      || item.sub2apiAccount?.credentials?.chatgpt_account_id
      || item.sub2apiAccount?.name
      || `${item.sourceName}:${item.sourcePath}`;
    byKey.set(String(key).toLowerCase(), item);
  }
  return [...byKey.values()];
}

async function readExistingIndividualDocuments(accountsDir) {
  if (!await pathExists(accountsDir)) {
    return [];
  }

  const files = await collectJsonFiles(accountsDir);
  const converted = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      if (Array.isArray(parsed.accounts)) {
        for (const account of parsed.accounts) {
          converted.push({
            sourceName: path.basename(file),
            sourcePath: '$.accounts[]',
            email: account?.credentials?.email || account?.extra?.email,
            name: account?.name,
            expiresAt: account?.credentials?.expires_at,
            sub2apiAccount: account,
          });
        }
      }
    } catch {
      // Ignore malformed old exports; the source auth files remain authoritative.
    }
  }
  return converted;
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

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.inputs.length) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const now = new Date();
  const outDir = path.resolve(args.outDir);
  const accountsDir = path.join(outDir, 'accounts');
  const inputFiles = [];
  for (const input of args.inputs) {
    inputFiles.push(...await collectJsonFiles(path.resolve(input)));
  }

  if (!inputFiles.length) {
    throw new Error('No JSON input files found.');
  }

  const { converted, skipped } = await convertFiles(inputFiles, now);
  const existing = await readExistingIndividualDocuments(accountsDir);
  const allConverted = dedupeConverted([...existing, ...converted]);

  if (args.individual) {
    for (const item of converted) {
      const token = sanitizeFileToken(item.email || item.name || item.sub2apiAccount?.credentials?.chatgpt_account_id || 'account');
      const document = buildSub2apiDocument([item], now);
      await writeJson(path.join(accountsDir, `${token}.sub2api.json`), document);
    }
  }

  const combined = buildSub2apiDocument(allConverted, now);
  await writeJson(path.join(outDir, args.combinedName), combined);
  await writeJson(path.join(outDir, 'manifest.json'), {
    exported_at: normalizeTimestamp(now),
    output_dir: outDir,
    combined_file: path.join(outDir, args.combinedName),
    individual_dir: args.individual ? accountsDir : null,
    input_files: inputFiles,
    new_accounts: converted.length,
    total_accounts: allConverted.length,
    skipped,
    run_id: getTimestampToken(now),
  });

  console.log(`Converted ${converted.length} new account(s).`);
  console.log(`Combined sub2api JSON: ${path.join(outDir, args.combinedName)}`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length} item(s). See ${path.join(outDir, 'manifest.json')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
