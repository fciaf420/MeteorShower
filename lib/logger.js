// ~/lib/logger.js
import fs from 'fs';
import path from 'path';

let debugToConsole = false;
let baseLogDir = path.join(process.cwd(), 'logs');
let logDir = null;
let sessionId = null;
let textStream = null;
let jsonStream = null;

function ensureStreams() {
  if (!sessionId) {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const ts = now.toISOString().replace(/[:.]/g, '-');
    sessionId = `ms-${ts}`;
    logDir = path.join(baseLogDir, dateStr);
  }
  if (!fs.existsSync(logDir)) {
    try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}
  }
  if (!textStream) {
    const file = path.join(logDir, `${sessionId}.log`);
    try { textStream = fs.createWriteStream(file, { flags: 'a' }); } catch (_) {}
  }
  if (!jsonStream) {
    const file = path.join(logDir, `${sessionId}.jsonl`);
    try { jsonStream = fs.createWriteStream(file, { flags: 'a' }); } catch (_) {}
  }
}

function write(level, msg, meta) {
  ensureStreams();
  const time = new Date().toISOString();
  const line = `[${time}] [${level.toUpperCase()}] ${msg}\n`;
  try { textStream && textStream.write(line); } catch (_) {}
  try { jsonStream && jsonStream.write(JSON.stringify({ t: time, level, msg, ...(meta || {}) }) + '\n'); } catch (_) {}
}

export const logger = {
  get debugToConsole() { return debugToConsole; },
  setDebugToConsole(v) { debugToConsole = !!v; },
  start(meta = {}) {
    ensureStreams();
    write('info', 'session.start', meta);
  },
  info(msg, meta) {
    console.log(msg);
    write('info', msg, meta);
  },
  warn(msg, meta) {
    console.warn(msg);
    write('warn', msg, meta);
  },
  error(msg, meta) {
    console.error(msg);
    write('error', msg, meta);
  },
  debug(msg, meta) {
    if (debugToConsole) console.log(msg);
    write('debug', msg, meta);
  }
};

export default logger;

