// Global state
let currentStep = 1;
let walletAdapter = null;
let connection = null;
let selectedPool = null;
let botConfig = {};

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeWalletAdapter();
    setupEventListeners();
    updateStepVisibility();
});

// Wallet Adapter Setup
function initializeWalletAdapter() {
    try {
        // Initialize wallet adapters (Phantom, Solflare, etc.)
        const wallets = [
            new window.SolanaWalletAdapterWallets.PhantomWalletAdapter(),
            new window.SolanaWalletAdapterWallets.SolflareWalletAdapter(),
            new window.SolanaWalletAdapterWallets.TorusWalletAdapter(),
        ];
        
        console.log('Wallet adapters initialized');
    } catch (error) {
        console.error('Failed to initialize wallet adapters:', error);
    }
}

// Event Listeners Setup
function setupEventListeners() {
    // Wallet connection
    document.getElementById('connectWallet').addEventListener('click', connectWallet);
    
    // Step navigation
    document.getElementById('testConnection').addEventListener('click', testConnection);
    document.getElementById('nextStep1').addEventListener('click', () => goToStep(2));
    document.getElementById('prevStep2').addEventListener('click', () => goToStep(1));
    document.getElementById('nextStep2').addEventListener('click', () => goToStep(3));
    document.getElementById('prevStep3').addEventListener('click', () => goToStep(2));
    document.getElementById('nextStep3').addEventListener('click', () => goToStep(4));
    document.getElementById('prevStep4').addEventListener('click', () => goToStep(3));
    document.getElementById('nextStep4').addEventListener('click', () => goToStep(5));
    document.getElementById('prevStep5').addEventListener('click', () => goToStep(4));
    document.getElementById('launchBot').addEventListener('click', launchBot);
    
    // Pool selection
    document.querySelectorAll('.pool-card').forEach(card => {
        card.addEventListener('click', () => selectPool(card.dataset.pool));
    });
    
    document.getElementById('customPool').addEventListener('input', handleCustomPoolInput);
    
    // Configuration inputs
    document.getElementById('rpcUrl').addEventListener('input', handleRpcUrlChange);
    document.getElementById('solAmount').addEventListener('input', updateCapitalDisplay);
    document.getElementById('allocationSlider').addEventListener('input', updateAllocationDisplay);
    document.getElementById('binSpan').addEventListener('input', updateBinSpanDisplay);
    
    // Amount presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => setAmountPreset(btn.dataset.percent));
    });
    
    // Strategy selection
    document.querySelectorAll('.strategy-option').forEach(option => {
        option.addEventListener('click', () => selectStrategy(option.dataset.strategy));
    });
    
    // Risk management toggles
    document.getElementById('takeProfitEnabled').addEventListener('change', toggleTakeProfit);
    document.getElementById('stopLossEnabled').addEventListener('change', toggleStopLoss);
    document.getElementById('swaplessRebalance').addEventListener('change', toggleSwaplessRebalance);
    document.getElementById('autoCompound').addEventListener('change', toggleAutoCompound);
    
    // Bot controls
    document.getElementById('pauseBot').addEventListener('click', pauseBot);
    document.getElementById('stopBot').addEventListener('click', stopBot);
}

// Wallet Connection
async function connectWallet() {
    try {
        const connectBtn = document.getElementById('connectWallet');
        connectBtn.textContent = 'Connecting...';
        connectBtn.disabled = true;
        
        // Check if Phantom is available
        if (window.solana && window.solana.isPhantom) {
            const response = await window.solana.connect();
            const publicKey = response.publicKey.toString();
            
            // Update UI
            document.getElementById('connectWallet').classList.add('hidden');
            document.getElementById('walletInfo').classList.remove('hidden');
            document.querySelector('.wallet-address').textContent = 
                `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
            
            // Get balance
            await updateWalletBalance();
            
            // Update status
            updateWalletStatus(true);
            
            console.log('Wallet connected:', publicKey);
        } else {
            throw new Error('Phantom wallet not found. Please install Phantom wallet.');
        }
    } catch (error) {
        console.error('Wallet connection failed:', error);
        alert('Failed to connect wallet: ' + error.message);
        
        // Reset button
        const connectBtn = document.getElementById('connectWallet');
        connectBtn.textContent = 'Connect Wallet';
        connectBtn.disabled = false;
    }
}

async function updateWalletBalance() {
    try {
        if (!window.solana || !window.solana.publicKey) return;
        
        const rpcUrl = document.getElementById('rpcUrl').value || 'https://api.mainnet-beta.solana.com';
        connection = new window.solanaWeb3.Connection(rpcUrl, 'confirmed');
        
        const balance = await connection.getBalance(window.solana.publicKey);
        const solBalance = balance / window.solanaWeb3.LAMPORTS_PER_SOL;
        
        document.querySelector('.wallet-balance').textContent = `${solBalance.toFixed(4)} SOL`;
        document.getElementById('availableBalance').textContent = Math.max(0, solBalance - 0.07).toFixed(4);
        
    } catch (error) {
        console.error('Failed to get wallet balance:', error);
        document.querySelector('.wallet-balance').textContent = 'Error loading balance';
    }
}

// Connection Testing
async function testConnection() {
    const rpcUrl = document.getElementById('rpcUrl').value;
    const testBtn = document.getElementById('testConnection');
    const rpcStatus = document.getElementById('rpcStatus');
    
    if (!rpcUrl) {
        alert('Please enter an RPC URL');
        return;
    }
    
    testBtn.textContent = 'Testing...';
    testBtn.disabled = true;
    
    try {
        connection = new window.solanaWeb3.Connection(rpcUrl, 'confirmed');
        
        // Test the connection
        const version = await connection.getVersion();
        console.log('RPC Version:', version);
        
        // Update status
        rpcStatus.innerHTML = '<span class="status-icon">✅</span><span>RPC Connection: Connected</span>';
        
        // Update wallet balance if connected
        if (window.solana && window.solana.publicKey) {
            await updateWalletBalance();
        }
        
        // Enable next step if wallet is also connected
        updateNextStepButton();
        
    } catch (error) {
        console.error('RPC connection failed:', error);
        rpcStatus.innerHTML = '<span class="status-icon">❌</span><span>RPC Connection: Failed</span>';
        alert('RPC connection failed: ' + error.message);
    } finally {
        testBtn.textContent = 'Test Connection';
        testBtn.disabled = false;
    }
}

function updateWalletStatus(connected) {
    const walletStatus = document.getElementById('walletStatus');
    if (connected) {
        walletStatus.innerHTML = '<span class="status-icon">✅</span><span>Wallet: Connected</span>';
    } else {
        walletStatus.innerHTML = '<span class="status-icon">❌</span><span>Wallet: Not connected</span>';
    }
    updateNextStepButton();
}

function updateNextStepButton() {
    const rpcConnected = document.getElementById('rpcStatus').textContent.includes('Connected');
    const walletConnected = document.getElementById('walletStatus').textContent.includes('Connected');
    const nextBtn = document.getElementById('nextStep1');
    
    nextBtn.disabled = !(rpcConnected && walletConnected);
}

// Step Navigation
function goToStep(step) {
    // Validate current step before proceeding
    if (!validateCurrentStep()) {
        return;
    }
    
    currentStep = step;
    updateStepVisibility();
    updateProgressBar();
    
    // Update configuration summary if going to step 5
    if (step === 5) {
        updateConfigurationSummary();
    }
}

function updateStepVisibility() {
    document.querySelectorAll('.step-content').forEach(content => {
        content.classList.remove('active');
    });
    
    const activeContent = document.querySelector(`[data-step="${currentStep}"]`);
    if (activeContent) {
        activeContent.classList.add('active');
    }
}

function updateProgressBar() {
    document.querySelectorAll('.progress-step').forEach(step => {
        const stepNumber = parseInt(step.dataset.step);
        step.classList.remove('active', 'completed');
        
        if (stepNumber === currentStep) {
            step.classList.add('active');
        } else if (stepNumber < currentStep) {
            step.classList.add('completed');
        }
    });
}

function validateCurrentStep() {
    switch (currentStep) {
        case 1:
            return document.getElementById('rpcStatus').textContent.includes('Connected') &&
                   document.getElementById('walletStatus').textContent.includes('Connected');
        case 2:
            return selectedPool !== null;
        case 3:
            const solAmount = parseFloat(document.getElementById('solAmount').value);
            return solAmount > 0 && solAmount >= 0.001;
        case 4:
            return true; // Risk management is optional
        default:
            return true;
    }
}

// Pool Selection
function selectPool(poolAddress) {
    selectedPool = poolAddress;
    
    // Update UI
    document.querySelectorAll('.pool-card').forEach(card => {
        card.classList.remove('selected');
    });
    
    document.querySelector(`[data-pool="${poolAddress}"]`).classList.add('selected');
    
    // Clear custom pool input
    document.getElementById('customPool').value = '';
    
    // Load pool information
    loadPoolInfo(poolAddress);
    
    // Enable next step
    document.getElementById('nextStep2').disabled = false;
}

function handleCustomPoolInput(event) {
    const poolAddress = event.target.value.trim();
    
    if (poolAddress.length >= 43 && poolAddress.length <= 44) {
        // Clear selected pool cards
        document.querySelectorAll('.pool-card').forEach(card => {
            card.classList.remove('selected');
        });
        
        selectedPool = poolAddress;
        loadPoolInfo(poolAddress);
        document.getElementById('nextStep2').disabled = false;
    } else {
        selectedPool = null;
        document.getElementById('poolInfo').classList.add('hidden');
        document.getElementById('nextStep2').disabled = true;
    }
}

async function loadPoolInfo(poolAddress) {
    try {
        // This would normally fetch from the DLMM SDK
        // For now, we'll show placeholder data
        const poolInfo = document.getElementById('poolInfo');
        
        // Show loading state
        document.getElementById('tokenX').textContent = 'Loading...';
        document.getElementById('tokenY').textContent = 'Loading...';
        document.getElementById('binStep').textContent = 'Loading...';
        document.getElementById('activeBin').textContent = 'Loading...';
        
        poolInfo.classList.remove('hidden');
        
        // Simulate API call
        setTimeout(() => {
            if (poolAddress === '6wJ7W3oHj7ex6MVFp2o26NSof3aey7U8Brs8E371WCXA') {
                document.getElementById('tokenX').textContent = 'SOL';
                document.getElementById('tokenY').textContent = 'USDC';
                document.getElementById('binStep').textContent = '25 bp';
                document.getElementById('activeBin').textContent = '8193';
            } else {
                document.getElementById('tokenX').textContent = 'Token X';
                document.getElementById('tokenY').textContent = 'Token Y';
                document.getElementById('binStep').textContent = '25 bp';
                document.getElementById('activeBin').textContent = 'Unknown';
            }
        }, 1000);
        
    } catch (error) {
        console.error('Failed to load pool info:', error);
        document.getElementById('poolInfo').classList.add('hidden');
    }
}

// Configuration Handlers
function handleRpcUrlChange() {
    // Reset connection status when URL changes
    document.getElementById('rpcStatus').innerHTML = 
        '<span class="status-icon">⏳</span><span>RPC Connection: Not tested</span>';
    updateNextStepButton();
}

function updateCapitalDisplay() {
    const amount = parseFloat(document.getElementById('solAmount').value) || 0;
    const available = parseFloat(document.getElementById('availableBalance').textContent) || 0;
    
    // Update preset button states
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Validate amount
    const solAmountInput = document.getElementById('solAmount');
    if (amount > available) {
        solAmountInput.style.borderColor = '#ef4444';
    } else {
        solAmountInput.style.borderColor = '#e5e7eb';
    }
}

function setAmountPreset(percent) {
    const available = parseFloat(document.getElementById('availableBalance').textContent) || 0;
    const amount = (available * parseInt(percent)) / 100;
    
    document.getElementById('solAmount').value = amount.toFixed(4);
    
    // Update button states
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    updateCapitalDisplay();
}

function updateAllocationDisplay() {
    const slider = document.getElementById('allocationSlider');
    const value = parseInt(slider.value);
    
    const tokenXPercent = 100 - value;
    const tokenYPercent = value;
    
    document.getElementById('tokenXLabel').textContent = `${tokenXPercent}% SOL`;
    document.getElementById('tokenYLabel').textContent = `${tokenYPercent}% USDC`;
}

function updateBinSpanDisplay() {
    const binSpan = parseInt(document.getElementById('binSpan').value) || 40;
    const binStep = 25; // This would come from pool info
    const coverage = (binSpan * binStep) / 100;
    
    document.getElementById('priceCoverage').textContent = `${coverage.toFixed(1)}%`;
}

function selectStrategy(strategy) {
    document.querySelectorAll('.strategy-option').forEach(option => {
        option.classList.remove('active');
    });
    
    document.querySelector(`[data-strategy="${strategy}"]`).classList.add('active');
    botConfig.strategy = strategy;
}

// Risk Management Toggles
function toggleTakeProfit() {
    const enabled = document.getElementById('takeProfitEnabled').checked;
    document.getElementById('takeProfitPercent').disabled = !enabled;
}

function toggleStopLoss() {
    const enabled = document.getElementById('stopLossEnabled').checked;
    document.getElementById('stopLossPercent').disabled = !enabled;
}

function toggleSwaplessRebalance() {
    const enabled = document.getElementById('swaplessRebalance').checked;
    const config = document.getElementById('swaplessConfig');
    
    if (enabled) {
        config.classList.remove('hidden');
    } else {
        config.classList.add('hidden');
    }
}

function toggleAutoCompound() {
    const enabled = document.getElementById('autoCompound').checked;
    botConfig.autoCompound = enabled;
}

// Configuration Summary
function updateConfigurationSummary() {
    const poolAddress = selectedPool;
    const solAmount = document.getElementById('solAmount').value;
    const allocation = document.getElementById('allocationSlider').value;
    const binSpan = document.getElementById('binSpan').value;
    const strategy = document.querySelector('.strategy-option.active')?.dataset.strategy || 'Spot';
    const takeProfitEnabled = document.getElementById('takeProfitEnabled').checked;
    const takeProfitPercent = document.getElementById('takeProfitPercent').value;
    const stopLossEnabled = document.getElementById('stopLossEnabled').checked;
    const stopLossPercent = document.getElementById('stopLossPercent').value;
    
    document.getElementById('summaryPool').textContent = 
        poolAddress === '6wJ7W3oHj7ex6MVFp2o26NSof3aey7U8Brs8E371WCXA' ? 'SOL/USDC' : 'Custom Pool';
    document.getElementById('summaryCapital').textContent = `${solAmount} SOL`;
    document.getElementById('summaryAllocation').textContent = `${100 - allocation}% / ${allocation}%`;
    document.getElementById('summaryBinSpan').textContent = `${binSpan} bins`;
    document.getElementById('summaryStrategy').textContent = strategy;
    document.getElementById('summaryTakeProfit').textContent = 
        takeProfitEnabled ? `+${takeProfitPercent}%` : 'Disabled';
    document.getElementById('summaryStopLoss').textContent = 
        stopLossEnabled ? `-${stopLossPercent}%` : 'Disabled';
}

// Bot Launch and Control
async function launchBot() {
    try {
        const launchBtn = document.getElementById('launchBot');
        launchBtn.textContent = 'Launching...';
        launchBtn.disabled = true;
        
        // Collect all configuration
        botConfig = {
            rpcUrl: document.getElementById('rpcUrl').value,
            poolAddress: selectedPool,
            solAmount: parseFloat(document.getElementById('solAmount').value),
            allocation: parseInt(document.getElementById('allocationSlider').value),
            binSpan: parseInt(document.getElementById('binSpan').value),
            strategy: document.querySelector('.strategy-option.active')?.dataset.strategy || 'Spot',
            takeProfitEnabled: document.getElementById('takeProfitEnabled').checked,
            takeProfitPercent: parseFloat(document.getElementById('takeProfitPercent').value),
            stopLossEnabled: document.getElementById('stopLossEnabled').checked,
            stopLossPercent: parseFloat(document.getElementById('stopLossPercent').value),
            swaplessRebalance: document.getElementById('swaplessRebalance').checked,
            swaplessBinSpan: parseInt(document.getElementById('swaplessBinSpan').value),
            autoCompound: document.getElementById('autoCompound').checked,
            monitorInterval: parseInt(document.getElementById('monitorInterval').value),
            priorityFee: parseInt(document.getElementById('priorityFee').value),
            walletPublicKey: window.solana.publicKey.toString()
        };
        
        console.log('Bot Configuration:', botConfig);
        
        // Here you would send the configuration to your backend
        // For now, we'll simulate the launch
        await simulateBotLaunch();
        
        // Switch to running view
        currentStep = 'running';
        updateStepVisibility();
        
        // Start monitoring simulation
        startMonitoringSimulation();
        
    } catch (error) {
        console.error('Failed to launch bot:', error);
        alert('Failed to launch bot: ' + error.message);
        
        const launchBtn = document.getElementById('launchBot');
        launchBtn.textContent = 'Launch Bot';
        launchBtn.disabled = false;
    }
}

async function simulateBotLaunch() {
    // Simulate API call to backend
    return new Promise(resolve => {
        setTimeout(() => {
            console.log('Bot launched successfully');
            resolve();
        }, 2000);
    });
}

function startMonitoringSimulation() {
    let positionValue = botConfig.solAmount * 100; // Simulate $100/SOL
    let pnl = 0;
    let fees = 0;
    let rebalances = 0;
    
    setInterval(() => {
        // Simulate price changes
        const change = (Math.random() - 0.5) * 10; // ±$5 change
        positionValue += change;
        pnl = positionValue - (botConfig.solAmount * 100);
        fees += Math.random() * 0.5; // Random fee accumulation
        
        // Simulate occasional rebalances
        if (Math.random() < 0.1) {
            rebalances++;
        }
        
        // Update UI
        document.getElementById('positionValue').textContent = `$${positionValue.toFixed(2)}`;
        document.getElementById('pnlValue').textContent = 
            `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${((pnl / (botConfig.solAmount * 100)) * 100).toFixed(1)}%)`;
        document.getElementById('feesEarned').textContent = `$${fees.toFixed(2)}`;
        document.getElementById('rebalanceCount').textContent = rebalances.toString();
        
        // Update P&L color
        const pnlElement = document.getElementById('pnlValue');
        pnlElement.style.color = pnl >= 0 ? '#059669' : '#dc2626';
        
    }, 5000); // Update every 5 seconds
}

function pauseBot() {
    alert('Bot paused. This would pause the monitoring and rebalancing.');
}

function stopBot() {
    if (confirm('Are you sure you want to stop the bot and close the position? This action cannot be undone.')) {
        alert('Bot stopped and position closed. This would trigger the emergency close functionality.');
        // Reset to step 1
        currentStep = 1;
        updateStepVisibility();
        updateProgressBar();
    }
}

// Utility Functions
function formatAddress(address) {
    if (!address) return '';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatNumber(num, decimals = 2) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    }).format(num);
}

// Error Handling
window.addEventListener('error', function(event) {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled promise rejection:', event.reason);
});