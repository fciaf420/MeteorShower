// configure.js – interactive .env generator with Solana wallet support
// -------------------------------------------------------------------
// • Reads example.env (template) line‑by‑line
// • Prompts the user for every KEY, offering the template value as default
// • Ensures a Solana key‑pair exists; if not, writes ./id.json in CWD
// • After creating a wallet, prints the public address
// • Adds the public address as a comment in the .env, e.g.
//     # WALLET_ADDRESS=6yP4…JWkq
//   just above the WALLET_PATH line.
// -------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const kvRegex = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/;

/* ---------- helpers -------------------------------------------------- */

/** Parse KEY=value pairs (ignore comments/blank lines). */
function parseTemplate(templatePath) {
  const lines = fs.readFileSync(templatePath, 'utf8').split(/\r?\n/);
  const pairs = [];

  lines.forEach((line, idx) => {
    const match = line.match(kvRegex);
    if (match) {
      pairs.push({ key: match[1], def: match[2] });
    } else if (line.trim() && !line.trim().startsWith('#')) {
      console.warn(`[warn] line ${idx + 1} ignored (not KEY=VALUE): ${line}`);
    }
  });

  return pairs;
}

/** Convert base58 private key to JSON array format and save to file */
function convertBase58ToWallet(base58Key, walletPath) {
  try {
    const secretKey = bs58.decode(base58Key);
    const kp = Keypair.fromSecretKey(secretKey);
    const walletData = JSON.stringify(Array.from(secretKey));
    
    fs.mkdirSync(path.dirname(walletPath), { recursive: true });
    fs.writeFileSync(walletPath, walletData);
    
    console.log(`[success] private key converted and saved to ${walletPath}`);
    return { path: walletPath, pubkey: kp.publicKey.toBase58() };
  } catch (err) {
    throw new Error(`Invalid base58 private key: ${err.message}`);
  }
}

/** Prompt user for wallet setup choice */
async function promptWalletSetup(rl) {
  console.log('\n🔑 Wallet Setup');
  console.log('Choose how to set up your wallet:');
  console.log('1. Create a new wallet');
  console.log('2. Import existing private key (base58 format from Phantom/Solflare)');
  console.log('3. Use existing wallet file');
  
  let choice;
  while (!choice || !['1', '2', '3'].includes(choice)) {
    choice = await rl.question('Enter your choice (1-3): ');
    choice = choice.trim();
  }
  
  return choice;
}

/** Handle wallet creation or import based on user choice */
async function handleWalletSetup(rl, defaultWalletPath) {
  const choice = await promptWalletSetup(rl);
  const absPath = path.resolve(defaultWalletPath);
  
  switch (choice) {
    case '1': {
      // Create new wallet
      console.log('[info] generating a new key‑pair …');
      const kp = Keypair.generate();
      
      try {
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, JSON.stringify(Array.from(kp.secretKey)));
        console.log(`[success] new key‑pair saved to ${absPath}`);
        return { path: absPath, pubkey: kp.publicKey.toBase58() };
      } catch (err) {
        // Fallback to ./id.json in CWD
        const fallback = path.join(process.cwd(), 'id.json');
        try {
          fs.writeFileSync(fallback, JSON.stringify(Array.from(kp.secretKey)));
          console.log(`[success] new key‑pair saved to ${fallback}`);
          return { path: fallback, pubkey: kp.publicKey.toBase58() };
        } catch (e) {
          throw new Error(`Failed to create wallet: ${e.message}`);
        }
      }
    }
    
    case '2': {
      // Import base58 private key
      let base58Key;
      while (!base58Key) {
        base58Key = await rl.question('Enter your base58 private key: ');
        base58Key = base58Key.trim();
        
        if (!base58Key) {
          console.log('[error] Private key cannot be empty. Please try again.');
          continue;
        }
        
        try {
          return convertBase58ToWallet(base58Key, absPath);
        } catch (err) {
          console.log(`[error] ${err.message}`);
          console.log('[info] Please make sure you copied the private key correctly.');
          base58Key = null; // Reset to prompt again
        }
      }
      break;
    }
    
    case '3': {
      // Use existing wallet file
      let existingPath;
      while (!existingPath) {
        existingPath = await rl.question(`Enter path to existing wallet file [${absPath}]: `);
        existingPath = existingPath.trim() || absPath;
        existingPath = path.resolve(existingPath);
        
        if (!fs.existsSync(existingPath)) {
          console.log(`[error] File not found: ${existingPath}`);
          existingPath = null; // Reset to prompt again
          continue;
        }
        
        try {
          const secret = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
          const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
          console.log(`[info] using existing wallet at ${existingPath}`);
          return { path: existingPath, pubkey: kp.publicKey.toBase58() };
        } catch (err) {
          console.log(`[error] Invalid wallet file format: ${err.message}`);
          existingPath = null; // Reset to prompt again
        }
      }
      break;
    }
  }
}

/** Legacy function for backward compatibility - now redirects to new wallet setup */
function ensureWallet(walletPath) {
  let absPath = path.resolve(walletPath);
  let kp;

  try {
    if (fs.existsSync(absPath)) {
      // Read existing wallet to get the public key
      const secret = JSON.parse(fs.readFileSync(absPath, 'utf8'));
      kp = Keypair.fromSecretKey(Uint8Array.from(secret));
      console.log(`[info] using existing wallet at ${absPath}`);
      return { path: absPath, pubkey: kp.publicKey.toBase58() };
    }

    console.log('[info] wallet file not found — generating a new key‑pair …');
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    kp = Keypair.generate();
    fs.writeFileSync(absPath, JSON.stringify(Array.from(kp.secretKey)));
    console.log(`[success] new key‑pair saved to ${absPath}`);
    return { path: absPath, pubkey: kp.publicKey.toBase58() };
  } catch (err) {
    console.error(`[warn] cannot write wallet at ${absPath}: ${err.message}`);

    // Fallback to ./id.json in CWD
    const fallback = path.join(process.cwd(), 'id.json');
    try {
      kp = Keypair.generate();
      fs.writeFileSync(fallback, JSON.stringify(Array.from(kp.secretKey)), {
        flag: 'wx',
      });
      console.log(`[success] new key‑pair saved to ${fallback}`);
      return { path: fallback, pubkey: kp.publicKey.toBase58() };
    } catch (e) {
      console.error(`[error] fallback wallet creation failed: ${e.message}`);
      // Return whatever info we have; pubkey may be undefined
      return { path: fallback, pubkey: kp?.publicKey?.toBase58() ?? '' };
    }
  }
}

/* ---------- main ----------------------------------------------------- */

async function main(templateFile = '.env.example', outputFile = '.env') {
  if (!fs.existsSync(templateFile)) {
    console.error(`[fatal] template not found: ${templateFile}`);
    return;
  }

  const templatePairs = parseTemplate(templateFile);
  const rl = readline.createInterface({ input, output });
  const answers = {};

  // Interactive prompt - skip WALLET_PATH, handle it separately
  const WALLET_VAR = 'WALLET_PATH';
  for (const { key, def } of templatePairs) {
    if (key === WALLET_VAR) {
      continue; // Skip WALLET_PATH, we'll handle it with the enhanced setup
    }
    
    try {
      const reply = await rl.question(`${key} [${def}]: `);
      answers[key] = reply.trim() ? reply.trim() : def;
    } catch (err) {
      console.error(`[error] reading ${key}: ${err.message}`);
      answers[key] = def;
    }
  }

  // Wallet handling ----------------------------------------------------
  // Find the default wallet path from template
  const walletTemplatePair = templatePairs.find(p => p.key === WALLET_VAR);
  let walletPath = walletTemplatePair?.def || path.join(process.cwd(), 'id.json');

  // Make relative paths explicit
  if (!path.isAbsolute(walletPath)) {
    walletPath = path.join(process.cwd(), walletPath);
  }

  // Check if wallet already exists, if so use it, otherwise prompt for setup
  let walletResult;
  if (fs.existsSync(path.resolve(walletPath))) {
    try {
      const secret = JSON.parse(fs.readFileSync(path.resolve(walletPath), 'utf8'));
      const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
      console.log(`[info] using existing wallet at ${path.resolve(walletPath)}`);
      walletResult = { path: path.resolve(walletPath), pubkey: kp.publicKey.toBase58() };
    } catch (err) {
      console.log(`[warn] existing wallet file is invalid: ${err.message}`);
      walletResult = await handleWalletSetup(rl, walletPath);
    }
  } else {
    walletResult = await handleWalletSetup(rl, walletPath);
  }

  const { path: finalWalletPath, pubkey } = walletResult;
  answers[WALLET_VAR] = finalWalletPath;
  
  rl.close();

  if (pubkey) {
    console.log(`[info] wallet public address: ${pubkey}`);
  }

  // Write .env ---------------------------------------------------------
  try {
    const lines = [];
    for (const [key, val] of Object.entries(answers)) {
      if (key === WALLET_VAR && pubkey) {
        lines.push(`# WALLET_ADDRESS=${pubkey}`); // comment with address
      }
      lines.push(`${key}=${val}`);
    }

    fs.writeFileSync(outputFile, lines.join('\n') + '\n');
    console.log(`[success] wrote ${outputFile}`);
  } catch (err) {
    console.error(`[error] writing ${outputFile}: ${err.message}`);
  }
}

main().catch((err) => console.error(`[fatal] unhandled: ${err.message}`));