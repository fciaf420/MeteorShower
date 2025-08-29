// wallet-info.js – Wallet information helper
// -------------------------------------------------------------------
// • Displays wallet public key, private key (base58), and file location
// • Loads wallet from .env WALLET_PATH or prompts for path
// • Includes security warnings for private key display
// -------------------------------------------------------------------

import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import 'dotenv/config';

/* ---------- helpers -------------------------------------------------- */

/** Load wallet from file and return keypair info */
function loadWalletInfo(walletPath) {
  try {
    const absolutePath = path.resolve(walletPath);
    
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Wallet file not found: ${absolutePath}`);
    }
    
    const secretKeyArray = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKeyArray));
    const privateKeyBase58 = bs58.encode(keypair.secretKey);
    
    return {
      path: absolutePath,
      publicKey: keypair.publicKey.toBase58(),
      privateKeyBase58: privateKeyBase58,
      privateKeyArray: secretKeyArray
    };
  } catch (err) {
    throw new Error(`Failed to load wallet: ${err.message}`);
  }
}

/** Display wallet information with security warnings */
function displayWalletInfo(walletInfo, showPrivateKey = false) {
  console.log('\n🔑 Wallet Information');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📁 Wallet Location: ${walletInfo.path}`);
  console.log(`🔓 Public Key:      ${walletInfo.publicKey}`);
  
  if (showPrivateKey) {
    console.log('\n⚠️  SECURITY WARNING ⚠️');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚨 NEVER share your private key with anyone!');
    console.log('🚨 Anyone with access to this key can control your wallet!');
    console.log('🚨 Make sure you\'re in a secure environment!');
    console.log('🚨 DESTROY this information after use - clear your terminal!');
    console.log('🚨 If anyone else gets this info YOU WILL LOSE ALL FUNDS!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔑 Private Key (base58): ${walletInfo.privateKeyBase58}`);
    console.log(`🔑 Private Key (array):  [${walletInfo.privateKeyArray.join(',')}]`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  REMEMBER: Clear your terminal history after copying this info!');
    console.log('⚠️  This private key = FULL ACCESS to your wallet funds!');
  } else {
    console.log('\n💡 To display private key, run: node wallet-info.js --show-private');
  }
  
  console.log('\n📋 Quick Copy Commands:');
  console.log(`   Public Key:  ${walletInfo.publicKey}`);
  if (showPrivateKey) {
    console.log(`   Private Key: ${walletInfo.privateKeyBase58}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

/** Prompt user for wallet file path */
async function promptWalletPath(rl, defaultPath) {
  console.log('\n📁 Wallet File Location');
  let walletPath;
  
  while (!walletPath) {
    walletPath = await rl.question(`Enter wallet file path [${defaultPath}]: `);
    walletPath = walletPath.trim() || defaultPath;
    walletPath = path.resolve(walletPath);
    
    if (!fs.existsSync(walletPath)) {
      console.log(`❌ File not found: ${walletPath}`);
      console.log('💡 Make sure the path is correct and the file exists.');
      walletPath = null; // Reset to prompt again
    }
  }
  
  return walletPath;
}

/** Ask user for confirmation before showing private key */
async function confirmPrivateKeyDisplay(rl) {
  console.log('\n⚠️  SECURITY WARNING');
  console.log('You are about to display your PRIVATE KEY on screen.');
  console.log('🚨 Make sure you are in a secure, private environment!');
  console.log('🚨 Never share this key or take screenshots of it!');
  console.log('🚨 If anyone else gets this info YOU WILL LOSE ALL FUNDS!');
  console.log('🚨 You must DESTROY this information after use!');
  
  let confirm;
  while (!confirm || !['y', 'n', 'yes', 'no'].includes(confirm.toLowerCase())) {
    confirm = await rl.question('\nDo you want to display your private key? (y/n): ');
    confirm = confirm.trim().toLowerCase();
  }
  
  return confirm === 'y' || confirm === 'yes';
}

/* ---------- main ----------------------------------------------------- */

async function main() {
  try {
    // Check for command line arguments
    const args = process.argv.slice(2);
    const showPrivateFlag = args.includes('--show-private') || args.includes('-p');
    const helpFlag = args.includes('--help') || args.includes('-h');
    
    if (helpFlag) {
      console.log('\n🔑 Wallet Info Helper');
      console.log('Usage: node wallet-info.js [options]');
      console.log('\nOptions:');
      console.log('  --show-private, -p   Show private key (with security confirmation)');
      console.log('  --help, -h           Show this help message');
      console.log('\nExamples:');
      console.log('  node wallet-info.js              # Show public key only');
      console.log('  node wallet-info.js --show-private  # Show all info including private key');
      return;
    }
    
    const rl = readline.createInterface({ input, output });
    
    // Try to get wallet path from environment first
    let walletPath = process.env.WALLET_PATH;
    
    if (!walletPath || !fs.existsSync(path.resolve(walletPath))) {
      if (walletPath && !fs.existsSync(path.resolve(walletPath))) {
        console.log(`⚠️  Wallet not found at WALLET_PATH: ${walletPath}`);
      } else {
        console.log('💡 No WALLET_PATH found in environment variables.');
      }
      
      const defaultPath = walletPath || path.join(process.cwd(), 'id.json');
      walletPath = await promptWalletPath(rl, defaultPath);
    } else {
      walletPath = path.resolve(walletPath);
      console.log(`📁 Using wallet from environment: ${walletPath}`);
    }
    
    // Load wallet information
    const walletInfo = loadWalletInfo(walletPath);
    
    // Determine if we should show private key
    let showPrivateKey = false;
    if (showPrivateFlag) {
      showPrivateKey = await confirmPrivateKeyDisplay(rl);
    }
    
    rl.close();
    
    // Display wallet information
    displayWalletInfo(walletInfo, showPrivateKey);
    
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => console.error(`[fatal] unhandled: ${err.message}`));