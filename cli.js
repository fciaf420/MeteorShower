// ───────────────────────────────────────────────
// ~/cli.js
// ───────────────────────────────────────────────
import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { main } from './main.js';
import { closeAllPositions } from './close-position.js';

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
  const argv = yargs(hideBin(process.argv))
    .command('run', 'start the liquidity bot', y =>
      y.option('interval', {
        alias      : 'i',
        type       : 'number',
        default    : 5,
        describe   : 'Monitor tick interval in seconds'
      })
    )
    .command('close', '⚡ EMERGENCY: close all positions and swap to SOL', () => {})
    .example('$0 run', 'Start the bot with 5 second monitoring')
    .example('$0 run -i 30', 'Start the bot with 30 second monitoring')
    .example('$0 close', 'Emergency close all positions and swap to SOL')
    .epilogue('💡 TIP: While bot is running, press Ctrl+C twice quickly for emergency exit')
    .demandCommand(1)
    .strict()
    .help()
    .parse();
    
  return argv;
}

async function runCli() {
  try {
    // Parse args first to handle --help before loading env
    const argv  = parseArgs();
    const { interval, _ } = argv;
    const command = _[0]; // Get the command (run, close, etc.)

    // Only load env if we're actually running a command (not just showing help)
    const env   = loadEnv();

    if (command === 'close') {
      // Handle close positions command
      console.log('🔄 Closing all positions and swapping to SOL...');
      await closeAllPositions();
      return;
    }

    // Default to 'run' command behavior
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
