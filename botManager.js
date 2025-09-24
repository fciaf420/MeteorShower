import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import BN from 'bn.js';
import bs58 from 'bs58';
import dlmmPackage from '@meteora-ag/dlmm';
import { getPrice } from './lib/price.js';
import { monitorPositionLoop } from './main.js';

const DLMM = dlmmPackage.default ?? dlmmPackage;

class PoolBot {
    constructor(config) {
        this.config = config;
        this.botId = config.botId;
        this.status = 'initializing';
        this.position = null;
        this.connection = null;
        this.dlmmPool = null;
        this.userKeypair = null;
        this.monitorInterval = null;
        this.metrics = {
            currentValue: 0,
            pnl: 0,
            pnlPercentage: 0,
            feesEarned: 0,
            rebalanceCount: 0,
            lastRebalance: null,
            initialValue: 0
        };
    }

    async start() {
        try {
            this.status = 'starting';

            // Setup connection
            this.connection = new Connection(this.config.rpcUrl, 'confirmed');
            
            // Setup keypair
            const privateKeyBytes = bs58.decode(this.config.privateKey);
            this.userKeypair = Keypair.fromSecretKey(privateKeyBytes);

            // Create DLMM pool instance
            const poolPK = new PublicKey(this.config.poolAddress);
            this.dlmmPool = await DLMM.create(this.connection, poolPK);

            // Open position using existing MeteorShower logic
            const result = await this.openPosition();
            
            if (result.success) {
                this.position = result.position;
                this.status = 'running';
                this.metrics.initialValue = this.config.solAmount;

                // Start monitoring
                this.startMonitoring();

                return {
                    success: true,
                    positionAddress: result.positionAddress
                };
            } else {
                this.status = 'error';
                return {
                    success: false,
                    error: result.error
                };
            }
        } catch (error) {
            this.status = 'error';
            return {
                success: false,
                error: error.message
            };
        }
    }

    async openPosition() {
        try {
            
    
            // Use existing openDlmmPosition logic from main.js
            const { openDlmmPosition } = await import('./lib/dlmm.js');
            
            // Convert allocation to token ratio object
            const tokenRatio = {
                ratioX: this.config.allocation,
                ratioY: 1 - this.config.allocation
            };


            const result = await openDlmmPosition(
                this.connection,
                this.userKeypair,
                this.config.solAmount,
                tokenRatio, // Proper token ratio object
                this.config.binSpan,
                this.config.poolAddress,
                this.config.liquidityStrategy,
                {
                    takeProfitEnabled: this.config.takeProfitEnabled,
                    takeProfitPercent: this.config.takeProfitPercent,
                    stopLossEnabled: this.config.stopLossEnabled,
                    stopLossPercent: this.config.stopLossPercent,
                    autoCompound: this.config.autoCompound
                }
            );

            return {
                success: true,
                position: result,
                positionAddress: result.positionPubKey.toBase58()
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    startMonitoring() {
        
        this.monitorInterval = setInterval(async () => {
            try {
                await this.updateMetrics();
            } catch (error) {
            }
        }, 5000); // Update every 5 seconds
    }

    async updateMetrics() {
        try {
            if (!this.position || !this.dlmmPool) return;

            // Get current position data
            const positionData = await this.dlmmPool.getPosition(this.position.positionPubKey);
            
            // Calculate current value
            const solPrice = await getPrice('So11111111111111111111111111111111111111112');
            const tokenPrice = await this.getTokenPrice();
            
            // Calculate P&L
            const currentValue = this.calculateCurrentValue(positionData, solPrice, tokenPrice);
            const pnl = currentValue - this.metrics.initialValue;
            const pnlPercentage = (pnl / this.metrics.initialValue) * 100;

            // Update metrics
            this.metrics.currentValue = currentValue;
            this.metrics.pnl = pnl;
            this.metrics.pnlPercentage = pnlPercentage;
            this.metrics.feesEarned = this.calculateFeesEarned(positionData);
            this.metrics.lastUpdate = new Date();

            // Check for rebalancing needs
            await this.checkRebalancing(positionData);

        } catch (error) {
        }
    }

    async getTokenPrice() {
        try {
            const tokenMint = this.dlmmPool.tokenX.publicKey.toString();
            return await getPrice(tokenMint);
        } catch (error) {
            return 0;
        }
    }

    calculateCurrentValue(positionData, solPrice, tokenPrice) {
        try {
            // Calculate current value based on position data
            let totalValue = 0;
            
            // Add SOL value
            if (positionData.positionData) {
                const solAmount = this.calculateSolAmount(positionData.positionData);
                totalValue += solAmount * solPrice;
            }
            
            // Add token value
            if (positionData.positionData && tokenPrice > 0) {
                const tokenAmount = this.calculateTokenAmount(positionData.positionData);
                totalValue += tokenAmount * tokenPrice;
            }
            
            return totalValue;
        } catch (error) {
            return 0;
        }
    }

    calculateSolAmount(positionData) {
        try {
            let solAmount = 0;
            
            if (positionData.positionBinData) {
                for (const bin of positionData.positionBinData) {
                    // Assuming X is SOL (this should be determined by pool configuration)
                    if (this.dlmmPool.tokenX.publicKey.toString() === 'So11111111111111111111111111111111111111112') {
                        solAmount += parseFloat(bin.positionXAmount) / Math.pow(10, this.dlmmPool.tokenX.decimal || 9);
                    }
                }
            }
            
            return solAmount;
        } catch (error) {
            return 0;
        }
    }

    calculateTokenAmount(positionData) {
        try {
            let tokenAmount = 0;
            
            if (positionData.positionBinData) {
                for (const bin of positionData.positionBinData) {
                    // Assuming Y is the token (this should be determined by pool configuration)
                    if (this.dlmmPool.tokenY.publicKey.toString() !== 'So11111111111111111111111111111111111111112') {
                        tokenAmount += parseFloat(bin.positionYAmount) / Math.pow(10, this.dlmmPool.tokenY.decimal || 6);
                    }
                }
            }
            
            return tokenAmount;
        } catch (error) {
            return 0;
        }
    }

    calculateFeesEarned(positionData) {
        try {
            if (!positionData.positionData) return 0;
            
            const feeX = new BN(positionData.positionData.feeX || 0);
            const feeY = new BN(positionData.positionData.feeY || 0);
            
            // Convert to SOL equivalent (simplified)
            const feeXSol = feeX.toNumber() / Math.pow(10, this.dlmmPool.tokenX.decimal || 9);
            const feeYSol = feeY.toNumber() / Math.pow(10, this.dlmmPool.tokenY.decimal || 6);
            
            return feeXSol + feeYSol;
        } catch (error) {
            return 0;
        }
    }

    async checkRebalancing(positionData) {
        try {
            // Check if position is out of range
            const activeBin = await this.dlmmPool.getActiveBin();
            const isInRange = this.isPositionInRange(positionData, activeBin);
            
            if (!isInRange) {
                await this.rebalancePosition();
            }
        } catch (error) {
        }
    }

    isPositionInRange(positionData, activeBin) {
        try {
            if (!positionData.positionData || !activeBin) return true;
            
            const lowerBinId = positionData.positionData.lowerBinId;
            const upperBinId = positionData.positionData.upperBinId;
            const currentBinId = activeBin.binId;
            
            return currentBinId >= lowerBinId && currentBinId <= upperBinId;
        } catch (error) {
            return true;
        }
    }

    async rebalancePosition() {
        try {
            
            // Use existing rebalancing logic from main.js
            const { recenterPosition } = await import('./lib/dlmm.js');
            
            const result = await recenterPosition(
                this.connection,
                this.dlmmPool,
                this.userKeypair,
                this.position.positionPubKey,
                this.config
            );
            
            if (result.success) {
                this.metrics.rebalanceCount++;
                this.metrics.lastRebalance = new Date();
            }
        } catch (error) {
        }
    }

    getMetrics() {
        return { ...this.metrics };
    }

    async stop() {
        try {
            this.status = 'stopping';
            
            // Stop monitoring
            if (this.monitorInterval) {
                clearInterval(this.monitorInterval);
                this.monitorInterval = null;
            }
            
            // Close position if needed
            if (this.position && this.dlmmPool) {
                await this.closePosition();
            }
            
            this.status = 'stopped';
            
        } catch (error) {
            this.status = 'error';
        }
    }

    async closePosition() {
        try {
            
            // Get the specific position for this pool
            const { userPositions } = await this.dlmmPool.getPositionsByUserAndLbPair(this.userKeypair.publicKey);
            
            if (userPositions.length === 0) {
                return;
            }
            
            // Close each position in this specific pool
            for (const position of userPositions) {
                try {
                    
                    // Use DLMM SDK to remove liquidity
                    const removeTxs = await this.dlmmPool.removeLiquidity({
                        position: position.publicKey,
                        user: this.userKeypair.publicKey,
                        fromBinId: position.positionData.lowerBinId,
                        toBinId: position.positionData.upperBinId,
                        bps: new BN(10_000), // 100% removal
                        shouldClaimAndClose: true,
                    });
                    
                    // Process each transaction
                    for (let i = 0; i < removeTxs.length; i++) {
                        const tx = removeTxs[i];
                        const signature = await this.connection.sendTransaction(tx, [this.userKeypair]);
                        await this.connection.confirmTransaction(signature, 'confirmed');
                    }
                    
                    
                } catch (posError) {
                }
            }
            
            // Convert any remaining tokens to SOL
            await this.convertTokensToSOL();
            
        } catch (error) {
        }
    }

    // Convert remaining tokens to SOL using the same approach as main.js
    async convertTokensToSOL() {
        try {
            // Wait for Jupiter balance index to update after position closure
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Use the same approach as swapPositionTokensToSol in main.js
            const { safeGetBalance, getMintDecimals } = await import('./lib/solana.js');
            const { swapTokensUltra } = await import('./lib/jupiter.js');
            const { getPrice } = await import('./lib/price.js');
            
            // Get the token mints from this specific pool
            const tokenXMint = this.dlmmPool.tokenX.publicKey.toString();
            const tokenYMint = this.dlmmPool.tokenY.publicKey.toString();
            const SOL_MINT = 'So11111111111111111111111111111111111111112';
            
            // Determine which token is SOL and which is the alt token
            const solMint = [tokenXMint, tokenYMint].find(mint => mint === SOL_MINT);
            const altTokenMint = [tokenXMint, tokenYMint].find(mint => mint !== SOL_MINT);
            
            if (!altTokenMint) {
                return;
            }
            
            
            try {
                // Get current token balance using safeGetBalance
                const { PublicKey } = await import('@solana/web3.js');
                const altTokenBalanceRaw = await safeGetBalance(this.connection, new PublicKey(altTokenMint), this.userKeypair.publicKey);
                
                // Check if we have any tokens to swap
                if (altTokenBalanceRaw.isZero() || altTokenBalanceRaw.lte(new BN(1000))) {
                    return;
                }
                
                // Get token decimals for UI display
                const decimals = await getMintDecimals(this.connection, new PublicKey(altTokenMint));
                const uiAmount = parseFloat(altTokenBalanceRaw.toString()) / Math.pow(10, decimals);
                
                // Check if amount is worth swapping (avoid dust)
                const tokenPrice = await getPrice(altTokenMint);
                const tokenValueUsd = uiAmount * tokenPrice;
                
                if (tokenValueUsd < 0.01) {
                    return;
                }
                
                // Prepare swap parameters
                const swapAmount = BigInt(altTokenBalanceRaw.toString());
                const SLIPPAGE_BPS = 100; // 1%
                const PRICE_IMPACT_PCT = 0.5; // 0.5%
                const signature = await swapTokensUltra(
                    altTokenMint,
                    SOL_MINT,
                    swapAmount,
                    this.userKeypair,
                    this.connection,
                    this.dlmmPool,
                    SLIPPAGE_BPS,
                    20,
                    PRICE_IMPACT_PCT
                );
                
                if (!signature) {
                    // Swap failed
                }
                
            } catch (swapError) {
            }
            
            // Unwrap any remaining WSOL
            try {
                const { unwrapWSOL } = await import('./lib/solana.js');
                await unwrapWSOL(this.connection, this.userKeypair);
            } catch (unwrapError) {
            }
            
        } catch (error) {
        }
    }

}

// Launch pool bot
async function launchPoolBot(config) {
    try {
        const bot = new PoolBot(config);
        const result = await bot.start();
        
        return {
            success: result.success,
            bot: result.success ? bot : null,
            positionAddress: result.positionAddress,
            error: result.error
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// Stop pool bot
async function stopPoolBot(bot) {
    try {
        await bot.stop();
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

export { 
    launchPoolBot, 
    stopPoolBot, 
    PoolBot 
};
