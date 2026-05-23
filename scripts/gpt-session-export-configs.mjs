#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = process.env.GPT_SESSION_EXPORT_PROJECT_DIR
  ? path.resolve(process.env.GPT_SESSION_EXPORT_PROJECT_DIR)
  : path.resolve(__dirname, '..', 'services', 'GPTSession2CPAandSub2API');
const DEFAULT_TARGETS = ['cpa', 'sub2api', 'cockpit', '9router'];

function parseArgs(argv) {
  const inputDirs = [];
  let outDir = '';
  let targets = DEFAULT_TARGETS;

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--out') {
      outDir = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (item === '--targets') {
      targets = String(argv[index + 1] || '')
        .split(',')
        .map((target) => target.trim().toLowerCase())
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (item.startsWith('--')) {
      throw new Error(`Unknown argument: ${item}`);
    }
    inputDirs.push(item);
  }

  if (!inputDirs.length) {
    throw new Error('Missing input directory.');
  }
  if (!outDir) {
    throw new Error('Missing --out directory.');
  }

  return { inputDirs, outDir, targets: targets.length ? targets : DEFAULT_TARGETS };
}

function createFakeElement(selector, options = {}) {
  const classes = new Set();
  return {
    selector,
    attributes: {},
    dataset: options.dataset || {},
    disabled: false,
    files: [],
    innerHTML: '',
    listeners: {},
    style: {},
    textContent: '',
    value: '',
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      toggle(name, force) {
        if (force) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      },
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    append() {},
    click() {
      this.listeners.click?.({ target: this });
    },
    remove() {},
    select() {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
}

function loadConverterPage() {
  const htmlPath = path.join(PROJECT_DIR, 'docs', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const match = html.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
  if (!match) {
    throw new Error(`Unable to locate inline converter script: ${htmlPath}`);
  }

  const elements = new Map();
  const formatButtons = ['sub2api', 'cpa', 'cockpit', '9router', 'axonhub', 'codexmanager'].map((format) =>
    createFakeElement(`[data-format="${format}"]`, { dataset: { format } })
  );
  const document = {
    body: createFakeElement('body'),
    createElement(selector) {
      return createFakeElement(selector);
    },
    execCommand() {
      return true;
    },
    querySelector(selector) {
      if (!elements.has(selector)) {
        elements.set(selector, createFakeElement(selector));
      }
      return elements.get(selector);
    },
    querySelectorAll(selector) {
      return selector === '[data-format]' ? formatButtons : [];
    },
  };
  const context = {
    TextDecoder,
    TextEncoder,
    URL: {
      createObjectURL() {
        return 'blob:export-configs';
      },
      revokeObjectURL() {},
    },
    atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
    btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
    clearTimeout,
    console,
    document,
    navigator: {
      clipboard: {
        async writeText() {},
      },
    },
    setTimeout,
  };

  vm.runInNewContext(match[1], context, { filename: htmlPath });
  return { elements, formatButtons };
}

function dispatch(element, type) {
  if (typeof element?.listeners?.[type] !== 'function') {
    throw new Error(`Missing ${type} listener on ${element?.selector || 'element'}`);
  }
  element.listeners[type]({ target: element });
}

function convertWithPage(text, target) {
  const { elements, formatButtons } = loadConverterPage();
  const button = formatButtons.find((item) => item.dataset.format === target);
  if (!button) {
    throw new Error(`Unsupported target: ${target}`);
  }
  const input = elements.get('#session-input');
  const output = elements.get('#output');
  dispatch(button, 'click');
  input.value = text;
  dispatch(input, 'input');
  const rawOutput = String(output.value || '').trim();
  if (!rawOutput) {
    const errorText = String(elements.get('#input-status')?.textContent || '').trim();
    throw new Error(errorText || `No output generated for target ${target}`);
  }
  return JSON.parse(rawOutput);
}

function listJsonFiles(inputDirs) {
  const files = [];
  for (const inputDir of inputDirs) {
    const root = path.resolve(inputDir);
    for (const item of fs.readdirSync(root, { withFileTypes: true })) {
      if (item.isFile() && item.name.toLowerCase().endsWith('.json')) {
        files.push(path.join(root, item.name));
      }
    }
  }
  return files;
}

function readInputJson(files) {
  const documents = [];
  for (const filePath of files) {
    try {
      documents.push(JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')));
    } catch (error) {
      throw new Error(`Failed to read ${filePath}: ${error.message}`);
    }
  }
  return JSON.stringify(documents.length === 1 ? documents[0] : documents);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main() {
  const { inputDirs, outDir, targets } = parseArgs(process.argv.slice(2));
  const resolvedOutDir = path.resolve(outDir);
  const inputFiles = listJsonFiles(inputDirs);
  if (!inputFiles.length) {
    throw new Error(`No JSON files found in input directories: ${inputDirs.join(', ')}`);
  }

  fs.mkdirSync(resolvedOutDir, { recursive: true });
  const inputText = readInputJson(inputFiles);
  const outputs = [];

  for (const target of targets) {
    const normalizedTarget = target === 'sub2' ? 'sub2api' : target;
    const document = convertWithPage(inputText, normalizedTarget);
    const filePath = path.join(resolvedOutDir, `${normalizedTarget}.json`);
    writeJson(filePath, document);
    outputs.push({
      target: normalizedTarget,
      filePath,
    });
  }

  const manifest = {
    ok: true,
    generatedAt: new Date().toISOString(),
    projectDir: PROJECT_DIR,
    inputDirs: inputDirs.map((item) => path.resolve(item)),
    inputFiles,
    outDir: resolvedOutDir,
    outputs,
  };
  writeJson(path.join(resolvedOutDir, 'manifest.json'), manifest);
  console.log(JSON.stringify(manifest, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
