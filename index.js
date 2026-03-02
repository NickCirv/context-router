#!/usr/bin/env node
import { createInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { request } from 'https';

// ─── ANSI Colors ────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};
const bold = (s) => `${c.bold}${s}${c.reset}`;
const dim = (s) => `${c.dim}${s}${c.reset}`;
const col = (color, s) => `${c[color]}${s}${c.reset}`;

// ─── Config ──────────────────────────────────────────────────────────────────
const LOG_FILE = join(homedir(), '.context-router-log.json');
const CONFIG_FILE = join(homedir(), '.context-router-config.json');

const MODELS = {
  haiku: {
    id: 'claude-haiku-4-5',
    displayName: 'Haiku',
    inputCostPer1K: 0.001,
    outputCostPer1K: 0.001,
    color: 'green',
    badge: '⚡',
    tagline: 'Fast & cheap — best for simple tasks',
  },
  sonnet: {
    id: 'claude-sonnet-4-5',
    displayName: 'Sonnet',
    inputCostPer1K: 0.003,
    outputCostPer1K: 0.015,
    color: 'cyan',
    badge: '✓',
    tagline: 'Balanced power — best for most coding tasks',
  },
  opus: {
    id: 'claude-opus-4-5',
    displayName: 'Opus',
    inputCostPer1K: 0.015,
    outputCostPer1K: 0.075,
    color: 'magenta',
    badge: '★',
    tagline: 'Maximum intelligence — best for complex reasoning',
  },
};

// ─── Routing Signals ─────────────────────────────────────────────────────────
const HAIKU_SIGNALS = [
  // Direct action keywords
  'fix typo', 'rename variable', 'format this', 'what is', 'what are',
  'spell check', 'correct spelling', 'add comment', 'remove comment',
  'update version', 'change name', 'list all', 'count the', 'find the',
  // Single-word triggers
  'simple', 'quick', 'fix', 'rename', 'format', 'list', 'check', 'lookup',
  'convert', 'parse', 'trim', 'validate', 'sanitize', 'capitalize', 'lowercase',
  'uppercase', 'sort', 'filter', 'map', 'wrap', 'unwrap', 'encode', 'decode',
  'translate', 'summarize', 'shorten', 'clarify', 'yes or no', 'true or false',
  // Question patterns (simple lookups)
  'how do i', 'what does', 'when was', 'where is', 'who is', 'is there',
  // Scope signals
  'one line', 'single file', 'small change', 'minor', 'trivial', 'basic',
];

const SONNET_SIGNALS = [
  // Implementation keywords
  'implement', 'write', 'create', 'build', 'develop', 'code', 'program',
  'add feature', 'new feature', 'add function', 'write function', 'write test',
  // Review and analysis
  'review', 'explain', 'debug', 'refactor', 'improve', 'optimize', 'analyse',
  'analyze', 'inspect', 'examine', 'test', 'verify', 'check code', 'lint',
  // Moderate complexity indicators
  'authentication', 'api endpoint', 'rest api', 'graphql', 'database query',
  'sql query', 'component', 'module', 'service', 'hook', 'middleware',
  'error handling', 'logging', 'caching', 'pagination', 'filtering',
  // Multi-step but scoped
  'integrate', 'connect', 'configure', 'setup', 'install', 'deploy',
  'migrate', 'update', 'upgrade', 'fix bug', 'resolve issue', 'patch',
  // Content creation
  'write docs', 'document', 'readme', 'changelog', 'comment this',
];

const OPUS_SIGNALS = [
  // Architecture & design
  'architect', 'architecture', 'design system', 'system design', 'design database',
  'database schema', 'schema design', 'data model', 'data modelling',
  // Strategic thinking
  'strategy', 'strategic', 'plan', 'roadmap', 'orchestrate', 'orchestration',
  'coordinate', 'evaluate', 'assess', 'compare approaches', 'trade-off', 'tradeoff',
  'trade off', 'pros and cons', 'decision matrix', 'weigh options',
  // Security & compliance
  'security audit', 'vulnerability', 'penetration test', 'threat model',
  'compliance', 'gdpr', 'hipaa', 'sox', 'authentication flow', 'authorization system',
  // Complex algorithms & reasoning
  'complex algorithm', 'algorithm design', 'distributed system', 'scalability',
  'performance bottleneck', 'race condition', 'concurrency', 'parallel processing',
  // Cross-system reasoning
  'multi-service', 'microservices', 'event-driven', 'message queue', 'saga pattern',
  'domain driven', 'ddd', 'event sourcing', 'cqrs',
  // Deep analysis
  'root cause', 'deep dive', 'comprehensive', 'thorough analysis', 'full audit',
  'entire codebase', 'all services', 'end to end', 'holistic',
];

// ─── Load / Save Helpers ─────────────────────────────────────────────────────
function loadLog() {
  if (!existsSync(LOG_FILE)) return [];
  try {
    return JSON.parse(readFileSync(LOG_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveLog(entries) {
  writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

function loadConfig() {
  const defaults = {
    haikuBoost: 0,
    opusBoost: 0,
    defaultConfirmRun: false,
  };
  if (!existsSync(CONFIG_FILE)) return defaults;
  try {
    return { ...defaults, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {
    return defaults;
  }
}

function saveConfig(cfg) {
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function appendLog(entry) {
  const log = loadLog();
  log.push(entry);
  saveLog(log);
}

// ─── Routing Engine ──────────────────────────────────────────────────────────
function classifyTask(task) {
  const lower = task.toLowerCase();
  const config = loadConfig();

  let haikuScore = 0;
  let sonnetScore = 0;
  let opusScore = 0;

  const matchedHaiku = [];
  const matchedSonnet = [];
  const matchedOpus = [];

  for (const signal of HAIKU_SIGNALS) {
    if (lower.includes(signal)) {
      haikuScore += signal.includes(' ') ? 2 : 1;
      matchedHaiku.push(signal);
    }
  }
  for (const signal of SONNET_SIGNALS) {
    if (lower.includes(signal)) {
      sonnetScore += signal.includes(' ') ? 2 : 1;
      matchedSonnet.push(signal);
    }
  }
  for (const signal of OPUS_SIGNALS) {
    if (lower.includes(signal)) {
      opusScore += signal.includes(' ') ? 2 : 1;
      matchedOpus.push(signal);
    }
  }

  // Apply calibration boosts
  haikuScore += config.haikuBoost || 0;
  opusScore += config.opusBoost || 0;

  const total = haikuScore + sonnetScore + opusScore;
  const allMatched = [
    ...matchedHaiku.map((s) => ({ signal: s, model: 'haiku' })),
    ...matchedSonnet.map((s) => ({ signal: s, model: 'sonnet' })),
    ...matchedOpus.map((s) => ({ signal: s, model: 'opus' })),
  ];

  let chosen;
  let confidence;
  let reason;

  if (total === 0) {
    // No signals → default to Sonnet
    chosen = 'sonnet';
    confidence = 50;
    reason = 'No strong signals detected — defaulting to Sonnet as safe choice';
  } else {
    const max = Math.max(haikuScore, sonnetScore, opusScore);
    const scores = { haiku: haikuScore, sonnet: sonnetScore, opus: opusScore };

    // Opus always wins if it has any score
    if (opusScore > 0 && opusScore >= sonnetScore && opusScore >= haikuScore) {
      chosen = 'opus';
    } else if (haikuScore > sonnetScore && haikuScore > opusScore) {
      chosen = 'haiku';
    } else if (sonnetScore >= haikuScore && sonnetScore >= opusScore) {
      chosen = 'sonnet';
    } else {
      chosen = 'sonnet';
    }

    confidence = Math.min(95, Math.round((scores[chosen] / total) * 100));

    // Ambiguity check
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    if (sorted[0][1] === sorted[1][1] && sorted[0][1] > 0) {
      confidence = 50;
      chosen = 'sonnet';
      reason = 'Ambiguous signals — defaulting to Sonnet as safe middle ground';
    }
  }

  // Build reason string
  if (!reason) {
    const signals = allMatched.filter((m) => m.model === chosen).map((m) => m.signal);
    reason = buildReason(chosen, signals);
  }

  return {
    model: chosen,
    confidence,
    reason,
    matched: allMatched,
    scores: { haiku: haikuScore, sonnet: sonnetScore, opus: opusScore },
  };
}

function buildReason(model, signals) {
  const reasons = {
    haiku: [
      'Simple task with clear scope — no complex reasoning needed',
      'Lookup or formatting task — Haiku handles this perfectly',
      'Quick fix or rename — lightweight model is ideal',
      'Straightforward question — Haiku gives fast, accurate answers',
    ],
    sonnet: [
      'Implementation task with moderate complexity — Sonnet is the sweet spot',
      'Code review or explanation — needs balanced intelligence',
      'Standard engineering task — Sonnet handles this well',
      'Multi-step but scoped — Sonnet has the right power level',
    ],
    opus: [
      'Architectural decision requiring deep cross-system reasoning',
      'Security or compliance work — needs maximum intelligence',
      'Strategic planning with complex trade-offs',
      'Complex algorithm design — Opus is justified here',
    ],
  };
  const pool = reasons[model];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Cost Estimation ─────────────────────────────────────────────────────────
function estimateTokens(task) {
  const words = task.split(/\s+/).length;
  const inputTokens = Math.max(100, words * 1.3 + 50);
  const outputTokens = inputTokens * 0.5;
  return { inputTokens: Math.round(inputTokens), outputTokens: Math.round(outputTokens) };
}

function calcCost(model, inputTokens, outputTokens) {
  const m = MODELS[model];
  return (
    (inputTokens / 1000) * m.inputCostPer1K +
    (outputTokens / 1000) * m.outputCostPer1K
  );
}

function formatCost(n) {
  if (n < 0.001) return `$${(n * 1000).toFixed(3)}m`;
  return `$${n.toFixed(4)}`;
}

// ─── Display ─────────────────────────────────────────────────────────────────
function printHeader() {
  console.log();
  console.log(col('cyan', bold('🧭 Context Router')));
  console.log(col('gray', '─'.repeat(40)));
}

function printRouting(task, result) {
  const { model, confidence, reason, matched, scores } = result;
  const { inputTokens, outputTokens } = estimateTokens(task);
  const m = MODELS[model];

  const haikuCost = calcCost('haiku', inputTokens, outputTokens);
  const sonnetCost = calcCost('sonnet', inputTokens, outputTokens);
  const opusCost = calcCost('opus', inputTokens, outputTokens);
  const chosenCost = calcCost(model, inputTokens, outputTokens);
  const savings = opusCost - chosenCost;
  const savingsPct = Math.round((savings / opusCost) * 100);

  console.log(`${col('gray', 'Task:')} ${bold('"' + task + '"')}`);
  console.log();

  // Analysis
  console.log(bold('Analysis:'));
  if (matched.length > 0) {
    const grouped = {};
    for (const m of matched) {
      if (!grouped[m.model]) grouped[m.model] = [];
      grouped[m.model].push(m.signal);
    }
    const parts = [];
    for (const [mdl, sigs] of Object.entries(grouped)) {
      const scoreStr = `+${scores[mdl]}`;
      parts.push(
        `${col(MODELS[mdl].color, mdl)} (${scoreStr}): ${sigs.slice(0, 3).join(', ')}${sigs.length > 3 ? ` +${sigs.length - 3} more` : ''}`
      );
    }
    console.log(`  ${col('gray', 'Signals:')} ${parts.join(' | ')}`);
  } else {
    console.log(`  ${col('gray', 'Signals:')} none detected`);
  }
  console.log(
    `  ${col('gray', 'Confidence:')} ${confidence}% → ${col(m.color, bold(m.displayName))}`
  );
  console.log(
    `  ${col('gray', 'Tokens est:')} ~${inputTokens} input, ~${outputTokens} output`
  );
  console.log();

  // Decision
  const badge = col(m.color, `${m.badge} ${m.displayName.toUpperCase()}`);
  console.log(`${bold('Routing Decision:')} ${badge}`);
  console.log(`  ${col('gray', 'Why:')} ${reason}`);
  console.log(`  ${col('gray', 'Model ID:')} ${m.id}`);
  console.log();

  // Cost breakdown
  console.log(bold('Cost Estimate:'));
  const models = ['haiku', 'sonnet', 'opus'];
  for (const mdl of models) {
    const cost = calcCost(mdl, inputTokens, outputTokens);
    const mm = MODELS[mdl];
    const marker = mdl === model ? col(mm.color, bold('← selected')) : col('gray', mm.tagline);
    const costStr = mdl === model ? col(mm.color, bold(formatCost(cost))) : col('gray', formatCost(cost));
    console.log(`  ${col(mm.color, mm.displayName.padEnd(8))} ${costStr.padEnd(20)} ${marker}`);
  }
  console.log();

  if (model !== 'opus') {
    console.log(
      `${col('green', bold(`Savings vs Opus: ${formatCost(savings)} (${savingsPct}% cheaper)`))} 💰`
    );
    console.log();
  }

  return { chosenCost, inputTokens, outputTokens };
}

// ─── Claude API Call ─────────────────────────────────────────────────────────
function callClaude(model, task) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      reject(new Error('ANTHROPIC_API_KEY not set'));
      return;
    }

    const body = JSON.stringify({
      model: MODELS[model].id,
      max_tokens: 1024,
      stream: true,
      messages: [{ role: 'user', content: task }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    let inputTokens = 0;
    let outputTokens = 0;
    let buffer = '';

    const req = request(options, (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', (d) => (errBody += d));
        res.on('end', () => reject(new Error(`API error ${res.statusCode}: ${errBody}`)));
        return;
      }

      console.log(col('gray', '─'.repeat(40)));
      console.log(col('cyan', bold(`${MODELS[model].displayName} response:`)));
      console.log();

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            if (json.type === 'content_block_delta' && json.delta?.text) {
              process.stdout.write(json.delta.text);
            }
            if (json.type === 'message_delta' && json.usage) {
              outputTokens = json.usage.output_tokens;
            }
            if (json.type === 'message_start' && json.message?.usage) {
              inputTokens = json.message.usage.input_tokens;
            }
          } catch {
            // skip malformed SSE
          }
        }
      });

      res.on('end', () => {
        console.log();
        resolve({ inputTokens, outputTokens });
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Interactive Prompt ───────────────────────────────────────────────────────
function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ─── Commands ─────────────────────────────────────────────────────────────────
function cmdLog() {
  const log = loadLog();
  if (log.length === 0) {
    console.log(col('gray', 'No entries yet. Run a task with --run to log costs.'));
    return;
  }

  printHeader();
  console.log(bold('Cost Log'));
  console.log(col('gray', '─'.repeat(60)));

  let total = 0;
  for (const entry of log.slice(-20)) {
    const date = new Date(entry.date).toLocaleDateString();
    const m = MODELS[entry.model];
    const cost = entry.cost;
    total += cost;
    const shortTask = entry.task.length > 40 ? entry.task.slice(0, 37) + '...' : entry.task;
    console.log(
      `  ${col('gray', date.padEnd(12))} ${col(m.color, m.displayName.padEnd(8))} ${formatCost(cost).padEnd(10)} ${col('gray', shortTask)}`
    );
  }

  console.log(col('gray', '─'.repeat(60)));
  console.log(`  ${bold('Running total:')} ${col('green', bold(formatCost(total)))} (${log.length} calls)`);
  console.log();
}

function cmdStats() {
  const log = loadLog();
  if (log.length === 0) {
    console.log(col('gray', 'No data yet.'));
    return;
  }

  printHeader();
  console.log(bold('Spend Breakdown'));
  console.log();

  const now = new Date();
  const thisMonth = log.filter((e) => {
    const d = new Date(e.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const thisWeek = log.filter((e) => {
    const d = new Date(e.date);
    const diff = (now - d) / 86400000;
    return diff <= 7;
  });

  function summarise(entries, label) {
    if (entries.length === 0) {
      console.log(`  ${bold(label)}: no data`);
      return;
    }
    const total = entries.reduce((s, e) => s + e.cost, 0);
    const byModel = {};
    for (const e of entries) {
      byModel[e.model] = (byModel[e.model] || 0) + e.cost;
    }
    console.log(`  ${bold(label)} — ${formatCost(total)} across ${entries.length} calls`);
    for (const [mdl, cost] of Object.entries(byModel)) {
      const m = MODELS[mdl];
      if (m) {
        const pct = Math.round((cost / total) * 100);
        console.log(`    ${col(m.color, m.displayName.padEnd(10))} ${formatCost(cost)} (${pct}%)`);
      }
    }
    console.log();
  }

  summarise(thisWeek, 'This week');
  summarise(thisMonth, 'This month');

  const allTotal = log.reduce((s, e) => s + e.cost, 0);
  console.log(`  ${bold('All time:')} ${col('green', bold(formatCost(allTotal)))} (${log.length} calls)`);
  console.log();
}

async function cmdCalibrate() {
  printHeader();
  console.log(bold('Calibration Quiz'));
  console.log(col('gray', 'Answer a few questions to tune your routing thresholds.'));
  console.log();

  const q1 = await prompt('Do you mostly do simple tasks (typos, renames, quick fixes)? (y/n): ');
  const q2 = await prompt('Do you often need architectural or strategic decisions? (y/n): ');
  const q3 = await prompt('Are you cost-sensitive (minimize spend)? (y/n): ');

  const config = loadConfig();

  if (q1 === 'y') config.haikuBoost = (config.haikuBoost || 0) + 2;
  if (q2 === 'y') config.opusBoost = (config.opusBoost || 0) + 2;
  if (q3 === 'y') config.haikuBoost = (config.haikuBoost || 0) + 1;

  saveConfig(config);
  console.log();
  console.log(col('green', 'Calibration saved.'));
  console.log(
    col('gray', `  Haiku boost: +${config.haikuBoost} | Opus boost: +${config.opusBoost}`)
  );
  console.log();
}

function cmdResetLog() {
  saveLog([]);
  console.log(col('green', 'Cost log cleared.'));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--log')) return cmdLog();
  if (args.includes('--stats')) return cmdStats();
  if (args.includes('--calibrate')) return cmdCalibrate();
  if (args.includes('--reset-log')) return cmdResetLog();

  const runFlag = args.includes('--run');
  const task = args.filter((a) => !a.startsWith('--')).join(' ');

  if (!task) {
    printHeader();
    console.log(bold('Usage:'));
    console.log('  npx context-router "your task"         Route a task, see model decision');
    console.log('  npx context-router "your task" --run   Route + call the selected model');
    console.log('  npx context-router --log               Show cost log');
    console.log('  npx context-router --stats             Weekly/monthly spend breakdown');
    console.log('  npx context-router --calibrate         Tune routing thresholds');
    console.log('  npx context-router --reset-log         Clear cost log');
    console.log();
    return;
  }

  printHeader();
  const result = classifyTask(task);
  const { chosenCost, inputTokens, outputTokens } = printRouting(task, result);
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

  if (!hasApiKey) {
    console.log(col('yellow', 'Note: ANTHROPIC_API_KEY not set — showing routing decision only.'));
    console.log(col('gray', 'Set it to use --run and call the actual model.'));
    console.log();
    return;
  }

  if (runFlag) {
    try {
      const actual = await callClaude(result.model, task);
      const actualCost = calcCost(
        result.model,
        actual.inputTokens || inputTokens,
        actual.outputTokens || outputTokens
      );
      appendLog({
        date: new Date().toISOString(),
        task: task.slice(0, 100),
        model: result.model,
        inputTokens: actual.inputTokens || inputTokens,
        outputTokens: actual.outputTokens || outputTokens,
        cost: actualCost,
      });
      console.log();
      console.log(col('gray', `Actual cost: ${formatCost(actualCost)} — logged to ${LOG_FILE}`));
    } catch (err) {
      console.error(col('red', `Error calling Claude: ${err.message}`));
    }
    return;
  }

  // Interactive confirm
  const answer = await prompt(
    `Run with ${col(MODELS[result.model].color, bold(MODELS[result.model].displayName))}? ${col('gray', '(y/n/h for haiku/s for sonnet/o for opus)')}: `
  );

  let chosenModel = result.model;
  if (answer === 'h') chosenModel = 'haiku';
  else if (answer === 's') chosenModel = 'sonnet';
  else if (answer === 'o') chosenModel = 'opus';
  else if (answer !== 'y') {
    console.log(col('gray', 'Aborted.'));
    return;
  }

  try {
    const actual = await callClaude(chosenModel, task);
    const actualCost = calcCost(
      chosenModel,
      actual.inputTokens || inputTokens,
      actual.outputTokens || outputTokens
    );
    appendLog({
      date: new Date().toISOString(),
      task: task.slice(0, 100),
      model: chosenModel,
      inputTokens: actual.inputTokens || inputTokens,
      outputTokens: actual.outputTokens || outputTokens,
      cost: actualCost,
    });
    console.log();
    console.log(col('gray', `Actual cost: ${formatCost(actualCost)} — logged to ${LOG_FILE}`));
  } catch (err) {
    console.error(col('red', `Error calling Claude: ${err.message}`));
  }
}

main().catch((err) => {
  console.error(col('red', `Fatal: ${err.message}`));
  process.exit(1);
});
