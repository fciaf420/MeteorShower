// ───────────────────────────────────────────────
// ~/cli.js
// ───────────────────────────────────────────────
import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { main } from './main.js';

function loadEnv() {
  const cfg = {
    RPC_URL      : process.env.RPC_URL,
    WALLET_PATH  : process.env.WALLET_PATH,
    LOG_LEVEL    : process.env.LOG_LEVEL ?? 'info'
  };

  if (!cfg.RPC_URL)    throw new Error('RPC_URL is not set');
  if (!cfg.WALLET_PATH) throw new Error('WALLET_PATH is not set');

  return cfg;
}

function parseArgs() {
  return yargs(hideBin(process.argv))
    .command('run', 'start the liquidity bot', y =>
      y.option('interval', {
        alias      : 'i',
        type       : 'number',
        default    : 5,
        describe   : 'Monitor tick interval in seconds'
      })
    )
    .demandCommand(1)
    .strict()
    .help()
    .parse();
}

async function runCli() {
  try {
    const env   = loadEnv();
    const argv  = parseArgs();
    const { interval } = argv;

    await main({
      ...env,
      MONITOR_INTERVAL_SECONDS : interval
    });
  } catch (err) {
    // Always exit with non-zero so systemd / Kubernetes knows it failed
    console.error('❌', err.message);
    process.exit(1);
  }
}

// Only run automatically if this file is invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli();
}

export { loadEnv, parseArgs, runCli };
