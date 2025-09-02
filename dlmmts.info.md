# SDK Functions

> DLMM

## Pool Functions

### create

Creates an instance of the DLMM pool given the pool address.

**Function**

```typescript
async create(
    connection: Connection, 
    dlmm: PublicKey, 
    opt?: {
        cluster?: Cluster | "localhost"; 
        programId?: PublicKey; 
    }
): Promise<DLMM>
```

**Parameters**

```typescript
connection: Connection         // Solana connection instance
dlmm: PublicKey                // The DLMM pool address
opt?: {                        // Optional parameters
  cluster?: Cluster | "localhost"; // The Solana cluster (mainnet, devnet, etc.)
  programId?: PublicKey; // Custom program ID if different from default
}
```

**Returns**

An instance of the DLMM pool.

**Example**

```typescript
// Creating a DLMM pool
// You can get your desired pool address from the API https://dlmm-api.meteora.ag/pair/all
const USDC_USDT_POOL = new PublicKey('ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq')
const dlmmPool = await DLMM.create(connection, USDC_USDT_POOL);
```

**Notes**

* The pool addresses can be fetched from the DLMM API [https://dlmm-api.meteora.ag/pair/all](https://dlmm-api.meteora.ag/pair/all)
* The `opt` parameter is optional and can be used to specify the cluster and program ID.

***

### createMultiple

Creates multiple instances of the DLMM pool given the pool addresses.

**Function**

```typescript
async createMultiple(
    connection: Connection, 
    dlmmList: Array<PublicKey>,
    opt?: {
        cluster?: Cluster | "localhost"; 
        programId?: PublicKey; 
    }
): Promise<DLMM[]>
```

**Parameters**

```typescript
connection: Connection         // Solana connection instance
dlmmList: Array<PublicKey>     // The array of DLMM pool addresses
opt?: {                        // Optional parameters
  cluster?: Cluster | "localhost"; // The Solana cluster (mainnet, devnet, etc.)
  programId?: PublicKey; // Custom program ID if different from default
}
```

**Returns**

An array of DLMM instances.

**Example**

```typescript
// Creating a DLMM pool
// You can get your desired pool address from the API https://dlmm-api.meteora.ag/pair/all
const USDC_USDT_POOL = new PublicKey('ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq')
const dlmmPool = await DLMM.createMultiple(connection, [USDC_USDT_POOL, ...]);
```

**Notes**

* The pool addresses can be fetched from the DLMM API [https://dlmm-api.meteora.ag/pair/all](https://dlmm-api.meteora.ag/pair/all)
* The `opt` parameter is optional and can be used to specify the cluster and program ID.

***

### createCustomizablePermissionlessLbPair

Creates a customizable permissionless LB pair. This function only supports token program.

**Function**

```typescript
static async createCustomizablePermissionlessLbPair(
    connection: Connection,
    binStep: BN,
    tokenX: PublicKey,
    tokenY: PublicKey,
    activeId: BN,
    feeBps: BN,
    activationType: ActivationType,
    hasAlphaVault: boolean,
    creatorKey: PublicKey,
    activationPoint?: BN,
    creatorPoolOnOffControl?: boolean,
    opt?: {
      cluster?: Cluster | "localhost";
      programId?: PublicKey;
    };
): Promise<Transaction>
```

**Parameters**

```typescript
connection: Connection         // Solana connection instance
binStep: BN                    // Bin step of the pair
tokenX: PublicKey              // Token X mint address
tokenY: PublicKey              // Token Y mint address
activeId: BN                   // Active bin ID
feeBps: BN                     // Fee in basis points
activationType: ActivationType // Activation type
hasAlphaVault: boolean         // Whether the pair has an alpha vault
creatorKey: PublicKey          // Creator key
activationPoint?: BN           // Optional activation point
creatorPoolOnOffControl?: boolean // Optional creator pool on/off control
opt?: Opt                      // Optional parameters
```

**Returns**

A transaction to create the customizable permissionless LB pair.

**Example**

```typescript
const WEN = new PublicKey('WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk')
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')

const binId = 8388608
const feeBps = new BN(100)
const activationPoint = new BN(1720000000)
const owner = new Keypair()

// Create a customizable permissionless LB pair
const transaction = await DLMM.createCustomizablePermissionlessLbPair(
  connection,
  new BN(binStep),
  WEN,
  USDC,
  new BN(binId.toString()),
  feeBps,
  ActivationType.Slot,
  false, // No alpha vault. 
  owner.publicKey,
  activationPoint,
  false,
  {
    cluster: "localhost",
  }
);
```

**Notes**

* If Alpha Vault is enabled, the program will deterministically whitelist the alpha vault to swap before the pool start trading. Check: [https://github.com/MeteoraAg/alpha-vault-sdk](https://github.com/MeteoraAg/alpha-vault-sdk) `initialize{Prorata|Fcfs}Vault` method to create the alpha vault.

***

### createCustomizablePermissionlessLbPair2

Creates a customizable permissionless LB pair with specified parameters. This function supports both token and token2022 programs.

**Function**

```typescript
static async createCustomizablePermissionlessLbPair2(
    connection: Connection,
    binStep: BN,
    tokenX: PublicKey,
    tokenY: PublicKey,
    activeId: BN,
    feeBps: BN,
    activationType: ActivationType,
    hasAlphaVault: boolean,
    creatorKey: PublicKey,
    activationPoint?: BN,
    creatorPoolOnOffControl?: boolean,
    opt?: Opt
): Promise<Transaction>
```

**Parameters**

```typescript
connection: Connection         // Solana connection instance
binStep: BN                   // The bin step for the pair
tokenX: PublicKey             // The mint of the first token
tokenY: PublicKey             // The mint of the second token
activeId: BN                  // The ID of the initial active bin (starting price)
feeBps: BN                    // The fee rate for swaps in basis points
activationType: ActivationType // The type of activation for the pair
hasAlphaVault: boolean        // Whether the pair has an alpha vault
creatorKey: PublicKey         // The public key of the creator
activationPoint?: BN          // Optional timestamp for activation
creatorPoolOnOffControl?: boolean // Optional creator control flag
opt?: Opt                     // Optional cluster and program ID
```

**Returns**

A transaction to create the customizable permissionless LB pair.

**Example**

```typescript
const WEN = new PublicKey('WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk')
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')

const binId = 8388608
const feeBps = new BN(100)
const activationPoint = new BN(1720000000)
const owner = new Keypair()

const transaction = await DLMM.createCustomizablePermissionlessLbPair2(
  connection,
  new BN(25), // 0.25% bin step
  WEN,
  USDC,
  new BN(binId.toString()), // active bin ID representing starting price
  new BN(feeBps.toString()), // 1% fee
  ActivationType.Timestamp,
  false, // no alpha vault
  owner.publicKey,
  activationPoint,
  false,
  {
    cluster: "localhost",
  }
);
```

**Notes**

* This creates a customizable permissionless pair that supports both token and token2022 programs
* The active bin ID represents the starting price of the pool
* Fee is specified in basis points (100 = 1%)

***

### createLbPair

Creates a new liquidity pair that supports only token program.

**Function**

```typescript
static async createLbPair(
    connection: Connection,
    funder: PublicKey,
    tokenX: PublicKey,
    tokenY: PublicKey,
    binStep: BN,
    baseFactor: BN,
    presetParameter: PublicKey,
    activeId: BN,
    opt?: Opt
): Promise<Transaction>
```

**Parameters**

```typescript
connection: Connection        // Solana connection instance
funder: PublicKey             // The public key of the funder
tokenX: PublicKey             // The mint of the first token
tokenY: PublicKey             // The mint of the second token
binStep: BN                   // The bin step for the pair
baseFactor: BN                // The base factor for the pair
presetParameter: PublicKey    // The public key of the preset parameter account
activeId: BN                  // The ID of the initial active bin
opt?: Opt                     // Optional parameters
```

**Returns**

A transaction to create the LB pair.

**Example**

```typescript
const WEN = new PublicKey('WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk')
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')

const activeBinId = 8388608
const binStep = new BN(25)
const baseFactor = new BN(10000)

const presetParamPda = derivePresetParameter2(
  binStep,
  baseFactor,
  programId
);

const activationPoint = new BN(1720000000)
const owner = new Keypair()

const transaction = await DLMM.createLbPair(
  connection,
  owner.publicKey,
  WEN,
  USDC,
  binStep,
  baseFactor, // base factor
  presetParamPda,
  activeBinId // active bin ID
);
```

**Notes**

* Throws an error if the pair already exists
* Only supports token program

***

### createLbPair2

Creates a new liquidity pair that supports both token and token2022 programs.

**Function**

```typescript
static async createLbPair2(
    connection: Connection,
    funder: PublicKey,
    tokenX: PublicKey,
    tokenY: PublicKey,
    presetParameter: PublicKey,
    activeId: BN,
    opt?: Opt
): Promise<Transaction>
```

**Parameters**

```typescript
connection: Connection        // Solana connection instance
funder: PublicKey             // The public key of the funder
tokenX: PublicKey             // The mint of the first token
tokenY: PublicKey             // The mint of the second token
presetParameter: PublicKey    // The public key of the preset parameter account
activeId: BN                  // The ID of the initial active bin
opt?: Opt                     // Optional parameters
```

**Returns**

A transaction to create the LB pair.

**Example**

```typescript
const WEN = new PublicKey('WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk')
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')

const activeBinId = 8388608
const binStep = new BN(25)
const baseFactor = new BN(10000)
const programId = LBCLMM_PROGRAM_IDS["mainnet-beta"]

const presetParamPda = derivePresetParameter2(
  binStep,
  baseFactor,
  programId
);


const transaction = await DLMM.createLbPair2(
  connection,
  owner.publicKey,
  WEN,
  USDC,
  presetParamPda,
  activeBinId // active bin ID
);
```

**Notes**

* Throws an error if the pair already exists
* Supports both token and token2022 programs

***

### initializePositionAndAddLiquidityByStrategy

Initializes a new position and adds liquidity using a specified strategy.

**Function**

```typescript
async initializePositionAndAddLiquidityByStrategy({
    positionPubKey,
    totalXAmount,
    totalYAmount,
    strategy,
    user,
    slippage,
}: TInitializePositionAndAddLiquidityParamsByStrategy): Promise<Transaction>
```

**Parameters**

```typescript
positionPubKey: PublicKey     // The public key of the position account (usually new Keypair())
totalXAmount: BN              // Total amount of token X to add
totalYAmount: BN              // Total amount of token Y to add
strategy: StrategyParameters  // Strategy parameters (can use calculateStrategyParameter)
user: PublicKey               // The public key of the user account
slippage?: number             // Optional slippage percentage
```

**Returns**

A transaction for initializing the position and adding liquidity.

**Example**

```typescript
const positionKeypair = new Keypair();

const btcInAmount = new BN(1).mul(new BN(10 ** btcDecimal));
const usdcInAmount = new BN(24000).mul(new BN(10 ** usdcDecimal));

const strategy = {
  strategyType: StrategyType.SpotBalanced,
  minBinId: 8388600,
  maxBinId: 8388620,
};

const transaction = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
  positionPubKey: positionKeypair.publicKey,
  totalXAmount: btcInAmount,
  totalYAmount: usdcInAmount,
  strategy,
  user: userPublicKey,
  slippage: 1 // 1% slippage
});
```

**Notes**

* `positionPubKey`: The public key of the position account. (usually use `new Keypair()`)
* `totalXAmount`: The total amount of token X to be added to the liquidity pool.
* `totalYAmount`: The total amount of token Y to be added to the liquidity pool.
* `strategy`: The strategy parameters to be used for the liquidity pool (Can use `calculateStrategyParameter` to calculate).
* `user`: The public key of the user account.
* `slippage`: The slippage percentage to be used for the liquidity pool.

***

### addLiquidityByStrategy

Adds liquidity to an existing position using a specified strategy.

**Function**

```typescript
async addLiquidityByStrategy({
    positionPubKey,
    totalXAmount,
    totalYAmount,
    strategy,
    user,
    slippage,
}: TInitializePositionAndAddLiquidityParamsByStrategy): Promise<Transaction>
```

**Parameters**

```typescript
positionPubKey: PublicKey     // The public key of the existing position
totalXAmount: BN              // Total amount of token X to add
totalYAmount: BN              // Total amount of token Y to add
strategy: StrategyParameters  // Strategy parameters
user: PublicKey               // The public key of the user account
slippage?: number             // Optional slippage percentage
```

**Returns**

A transaction for adding liquidity to the position.

**Example**

```typescript
const btcInAmount = new BN(1).mul(new BN(10 ** btcDecimal));
const usdcInAmount = new BN(24000).mul(new BN(10 ** usdcDecimal));

const transaction = await dlmmPool.addLiquidityByStrategy({
  positionPubKey: position.publicKey,
  totalXAmount: btcInAmount,
  totalYAmount: usdcInAmount,
  strategy: {
    minBinId: 8388600,
    maxBinId: 8388620,
    strategyType: StrategyType.SpotBalanced,
  },
  user: userPublicKey,
  slippage: 1
});
```

**Notes**

* `positionPubKey`: The public key of the position account. (usually use `new Keypair()`)
* `totalXAmount`: The total amount of token X to be added to the liquidity pool.
* `totalYAmount`: The total amount of token Y to be added to the liquidity pool.
* `strategy`: The strategy parameters to be used for the liquidity pool (Can use `calculateStrategyParameter` to calculate).
* `user`: The public key of the user account.
* `slippage`: The slippage percentage to be used for the liquidity pool.

***

### removeLiquidity

Removes liquidity from a position with options to claim rewards and close the position.

**Function**

```typescript
async removeLiquidity({
    user,
    position,
    fromBinId,
    toBinId,
    bps,
    shouldClaimAndClose = false,
}: {
    user: PublicKey;
    position: PublicKey;
    fromBinId: number;
    toBinId: number;
    bps: BN;
    shouldClaimAndClose?: boolean;
}): Promise<Transaction | Transaction[]>
```

**Parameters**

```typescript
user: PublicKey               // The public key of the user account
position: PublicKey           // The public key of the position account
fromBinId: number             // Starting bin ID to remove liquidity from
toBinId: number               // Ending bin ID to remove liquidity from
bps: BN                       // Percentage of liquidity to remove (in basis points)
shouldClaimAndClose?: boolean // Whether to claim rewards and close position
```

**Returns**

A transaction or array of transactions for removing liquidity.

**Example**

```typescript
// Remove 50% of liquidity from position
const transaction = await dlmmPool.removeLiquidity({
  user: userPublicKey,
  position: positionPublicKey,
  fromBinId: 8388600,
  toBinId: 8388620,
  bps: new BN(5000), // 50% in basis points
  shouldClaimAndClose: false
});
```

**Notes**

* `user`: The public key of the user account.
* `position`: The public key of the position account.
* `fromBinId`: The ID of the starting bin to remove liquidity from. Must within position range.
* `toBinId`: The ID of the ending bin to remove liquidity from. Must within position range.
* `liquiditiesBpsToRemove`: An array of numbers (percentage) that represent the liquidity to remove from each bin.
* `shouldClaimAndClose`: A boolean flag that indicates whether to claim rewards and close the position.

***

### swapQuote

Returns a quote for a swap operation.

**Function**

```typescript
swapQuote(
    inAmount: BN,
    swapForY: boolean,
    allowedSlippage: BN,
    binArrays: BinArrayAccount[],
    isPartialFill?: boolean,
    maxExtraBinArrays: number = 0
): SwapQuote
```

**Parameters**

```typescript
inAmount: BN                  // Amount of lamports to swap in
swapForY: boolean             // True to swap X to Y, false for Y to X
allowedSlippage: BN           // Allowed slippage in basis points
binArrays: BinArrayAccount[]  // Bin arrays for the swap quote
isPartialFill?: boolean       // Whether partial fill is allowed
maxExtraBinArrays?: number    // Maximum extra bin arrays to return
```

**Returns**

A SwapQuote object containing swap information.

**Example**

```typescript
const binArrays = await dlmmPool.getBinArrayForSwap(true, 5);
const swapQuote = dlmmPool.swapQuote(
  new BN(1000000), // 1 token input
  true, // swap X for Y
  new BN(100), // 1% slippage
  binArrays,
  false, // no partial fill
  2 // max extra bin arrays
);
```

**Notes**

* `inAmount`: Amount of lamport to swap in
* `swapForY`: Swap token X to Y when it is true, else reversed.
* `allowedSlippage`: Allowed slippage for the swap. Expressed in BPS. To convert from slippage percentage to BPS unit: SLIPPAGE\_PERCENTAGE \* 100
* `binArrays`: binArrays for swapQuote.
* `isPartialFill`: Flag to check whether the the swapQuote is partial fill, default = false.
* `maxExtraBinArrays`: Maximum number of extra binArrays to return

***

### swapQuoteExactOut

Returns a quote for a swap with exact output amount.

**Function**

```typescript
swapQuoteExactOut(
    outAmount: BN,
    swapForY: boolean,
    allowedSlippage: BN,
    binArrays: BinArrayAccount[],
    maxExtraBinArrays: number = 0
): SwapQuoteExactOut
```

**Parameters**

```typescript
outAmount: BN                 // Amount of lamports to swap out
swapForY: boolean             // True to swap X to Y, false for Y to X
allowedSlippage: BN           // Allowed slippage in basis points
binArrays: BinArrayAccount[]  // Bin arrays for the swap quote
maxExtraBinArrays?: number    // Maximum extra bin arrays to return
```

**Returns**

A SwapQuoteExactOut object containing swap information.

**Example**

```typescript
const binArrays = await dlmmPool.getBinArrayForSwap(true, 5);
const swapQuote = dlmmPool.swapQuoteExactOut(
  new BN(1000000), // 1 token output
  true, // swap X for Y
  new BN(100), // 1% slippage
  binArrays,
  2 // max extra bin arrays
);
```

**Notes**

* `outAmount`: Amount of lamport to swap out
* `swapForY`: Swap token X to Y when it is true, else reversed.
* `allowedSlippage`: Allowed slippage for the swap. Expressed in BPS. To convert from slippage percentage to BPS unit: SLIPPAGE\_PERCENTAGE \* 100
* `binArrays`: binArrays for swapQuote.
* `maxExtraBinArrays`: Maximum number of extra binArrays to return

***

### swapExactOut

Executes a swap operation with exact output amount.

**Function**

```typescript
async swapExactOut({
    inToken,
    outToken,
    outAmount,
    maxInAmount,
    lbPair,
    user,
    binArraysPubkey,
}: SwapExactOutParams): Promise<Transaction>
```

**Parameters**

```typescript
inToken: PublicKey            // The public key of input token mint
outToken: PublicKey           // The public key of output token mint
outAmount: BN                 // Exact amount of output token to receive
maxInAmount: BN               // Maximum amount of input token to spend
lbPair: PublicKey             // The public key of the liquidity pool
user: PublicKey               // The public key of the user account
binArraysPubkey: PublicKey[]  // Array of bin arrays involved in swap
```

**Returns**

A transaction for executing the exact out swap.

**Example**

```typescript
const swapTx = await dlmmPool.swapExactOut({
  inToken: tokenXMint,
  outToken: tokenYMint,
  outAmount: new BN(1000000), 
  maxInAmount: new BN(1100000), 
  lbPair: dlmmPool.pubkey,
  user: userPublicKey,
  binArraysPubkey: swapQuote.binArraysPubkey
});
```

**Notes**

* `inToken`: The public key of the input token mint.
* `outToken`: The public key of the output token mint.
* `outAmount`: The exact amount of output token to receive.
* `maxInAmount`: The maximum amount of input token to spend.
* `lbPair`: The public key of the liquidity pool.
* `user`: The public key of the user account.
* `binArraysPubkey`: The public key of the bin arrays involved in the swap.

***

### swapWithPriceImpact

Executes a swap with price impact constraints.

**Function**

```typescript
async swapWithPriceImpact({
    inToken,
    outToken,
    inAmount,
    lbPair,
    user,
    priceImpact,
    binArraysPubkey,
}: SwapWithPriceImpactParams): Promise<Transaction>
```

**Parameters**

```typescript
inToken: PublicKey            // The public key of input token mint
outToken: PublicKey           // The public key of output token mint
inAmount: BN                  // Amount of input token to swap
lbPair: PublicKey             // The public key of the liquidity pool
user: PublicKey               // The public key of the user account
priceImpact: BN               // Accepted price impact in basis points
binArraysPubkey: PublicKey[]  // Array of bin arrays involved in swap
```

**Returns**

A transaction for executing the swap with price impact constraints.

**Example**

```typescript
const swapTx = await dlmmPool.swapWithPriceImpact({
  inToken: tokenXMint,
  outToken: tokenYMint,
  inAmount: new BN(1000000),
  lbPair: dlmmPool.pubkey,
  user: userPublicKey,
  priceImpact: new BN(50), // 0.5% max price impact
  binArraysPubkey: binArrays.map(b => b.publicKey)
});
```

**Notes**

* `inToken`: The public key of the token to be swapped in.
* `outToken`: The public key of the token to be swapped out.
* `inAmount`: The amount of token to be swapped in.
* `priceImpact`: Accepted price impact bps.
* `lbPair`: The public key of the liquidity pool.
* `user`: The public key of the user account.
* `binArraysPubkey`: Array of bin arrays involved in the swap

***

### swap

Executes a swap operation.

**Function**

```typescript
async swap({
    inToken,
    outToken,
    inAmount,
    minOutAmount,
    lbPair,
    user,
    binArraysPubkey,
}: SwapParams): Promise<Transaction>
```

**Parameters**

```typescript
inToken: PublicKey            // The public key of input token mint
outToken: PublicKey           // The public key of output token mint
inAmount: BN                  // Amount of input token to swap
minOutAmount: BN              // Minimum amount of output token expected
lbPair: PublicKey             // The public key of the liquidity pool
user: PublicKey               // The public key of the user account
binArraysPubkey: PublicKey[]  // Array of bin arrays involved in swap
```

**Returns**

A transaction for executing the swap.

**Example**

```typescript
// Execute swap
const swapTx = await dlmmPool.swap({
  inToken: tokenXMint,
  outToken: tokenYMint,
  inAmount: new BN(1000000),
  minOutAmount: new BN(950000), // accounting for slippage
  lbPair: dlmmPool.pubkey,
  user: userPublicKey,
  binArraysPubkey: swapQuote.binArraysPubkey
});
```

**Notes**

* `inToken`: The public key of the token to be swapped in.
* `outToken`: The public key of the token to be swapped out.
* `inAmount`: The amount of token to be swapped in.
* `minOutAmount`: The minimum amount of token to be swapped out.
* `lbPair`: The public key of the liquidity pool.
* `user`: The public key of the user account.
* `binArraysPubkey`: Array of bin arrays involved in the swap

***

### claimLMReward

Claims liquidity mining rewards for a specific position.

**Function**

```typescript
async claimLMReward({
    owner,
    position,
}: {
    owner: PublicKey;
    position: LbPosition;
}): Promise<Transaction>
```

**Parameters**

```typescript
owner: PublicKey              // The public key of the position owner
position: LbPosition          // The position object containing position data
```

**Returns**

A transaction for claiming LM rewards.

**Example**

```typescript
// Claim LM rewards for a position
const position = await dlmmPool.getPosition(positionPublicKey);
const claimTx = await dlmmPool.claimLMReward({
  owner: userPublicKey,
  position
});
```

**Notes**

* This function is only available for LB pairs with liqudiity mining rewards.

***

### claimAllLMRewards

Claims all liquidity mining rewards for multiple positions.

**Function**

```typescript
async claimAllLMRewards({
    owner,
    positions,
}: {
    owner: PublicKey;
    positions: LbPosition[];
}): Promise<Transaction[]>
```

**Parameters**

```typescript
owner: PublicKey              // The public key of the positions owner
positions: LbPosition[]       // Array of position objects
```

**Returns**

Array of transactions for claiming all LM rewards.

**Example**

```typescript
const positions = await dlmmPool.getPositionsByUserAndLbPair(userPublicKey);
const claimTxs = await dlmmPool.claimAllLMRewards({
  owner: userPublicKey,
  positions: positions.userPositions
});
```

**Notes**

* This function is only available for LB pairs with liqudiity mining rewards.

***

### claimSwapFee

Claims swap fees earned by a specific position.

**Function**

```typescript
async claimSwapFee({
    owner,
    position,
}: {
    owner: PublicKey;
    position: LbPosition;
}): Promise<Transaction | null>
```

**Parameters**

```typescript
owner: PublicKey              // The public key of the position owner
position: LbPosition          // The position object containing position data
```

**Returns**

A transaction for claiming swap fees, or null if no fees to claim.

**Example**

```typescript
const position = await dlmmPool.getPosition(positionPublicKey);
const claimFeeTx = await dlmmPool.claimSwapFee({
  owner: userPublicKey,
  position
});
```

**Notes**

* The function `claimSwapFee` is used to claim swap fees for a specific position owned by a specific owner.

***

### claimAllSwapFee

Claims swap fees for multiple positions.

**Function**

```typescript
async claimAllSwapFee({
    owner,
    positions,
}: {
    owner: PublicKey;
    positions: LbPosition[];
}): Promise<Transaction[]>
```

**Parameters**

```typescript
owner: PublicKey              // The public key of the positions owner
positions: LbPosition[]       // Array of position objects
```

**Returns**

Array of transactions for claiming all swap fees.

**Example**

```typescript
// Claim all swap fees for user positions
const positions = await dlmmPool.getPositionsByUserAndLbPair(userPublicKey);
const claimFeeTxs = await dlmmPool.claimAllSwapFee({
  owner: userPublicKey,
  positions: positions.userPositions
});
```

**Notes**

* The `claimAllSwapFee` function to claim swap fees for multiple positions owned by a specific owner.

***

### claimAllRewards

Claims all rewards (both LM rewards and swap fees) for multiple positions.

**Function**

```typescript
async claimAllRewards({
    owner,
    positions,
}: {
    owner: PublicKey;
    positions: LbPosition[];
}): Promise<Transaction[]>
```

**Parameters**

```typescript
owner: PublicKey              // The public key of the positions owner
positions: LbPosition[]       // Array of position objects
```

**Returns**

Array of transactions for claiming all rewards.

**Example**

```typescript
const positions = await dlmmPool.getPositionsByUserAndLbPair(userPublicKey);
const claimAllTxs = await dlmmPool.claimAllRewards({
  owner: userPublicKey,
  positions: positions.userPositions
});
```

**Notes**

* The `claimAllRewards` function to claim swap fees and LM rewards for multiple positions owned by a specific owner.

***

### claimAllRewardsByPosition

Claims all rewards (both LM rewards and swap fees) for a specific position.

**Function**

```typescript
async claimAllRewardsByPosition({
    owner,
    position,
}: {
    owner: PublicKey;
    position: LbPosition;
}): Promise<Transaction[]>
```

**Parameters**

```typescript
owner: PublicKey              // The public key of the position owner
position: LbPosition          // The position object to claim rewards for
```

**Returns**

Array of transactions for claiming all rewards for the position.

**Example**

```typescript
// Claim all rewards for a specific position
const position = await dlmmPool.getPosition(positionPublicKey);
const claimAllTxs = await dlmmPool.claimAllRewardsByPosition({
  owner: userPublicKey,
  position
});
```

**Notes**

* The function `claimAllRewardsByPosition` allows a user to claim all rewards for a specific

***

### closePosition

Closes a position and recovers the rent.

**Function**

```typescript
async closePosition({
    owner,
    position,
}: {
    owner: PublicKey;
    position: LbPosition;
}): Promise<Transaction>
```

**Parameters**

```typescript
owner: PublicKey              // The public key of the position owner
position: LbPosition          // The position object to close
```

**Returns**

A transaction for closing the position.

**Example**

```typescript
// Close a position
const position = await dlmmPool.getPosition(positionPublicKey);
const closeTx = await dlmmPool.closePosition({
  owner: userPublicKey,
  position
});
```

**Notes**

* The function `closePosition` is used to close a position owned by a specific owner.

***

### closePositionIfEmpty

Closes a position if it is empty, otherwise does nothing.

**Function**

```typescript
async closePositionIfEmpty({
    owner,
    position,
}: {
    owner: PublicKey;
    position: LbPosition;
}): Promise<Transaction>
```

**Parameters**

```typescript
owner: PublicKey              // The public key of the position owner
position: LbPosition          // The position object to close
```

**Returns**

A transaction for closing the position if empty.

**Example**

```typescript
// Close position if empty
const position = await dlmmPool.getPosition(positionPublicKey);
const closeTx = await dlmmPool.closePositionIfEmpty({
  owner: userPublicKey,
  position
});
```

**Notes**

* The function `closePositionIfEmpty` is used to close a position owned by a specific owner if it is empty.

***

### quoteCreatePosition

Quotes the cost of creating a position with a given strategy.

**Function**

```typescript
async quoteCreatePosition({ strategy }: TQuoteCreatePositionParams)
```

**Parameters**

```typescript
strategy: StrategyParameters  // Strategy parameters containing min/max bin IDs
```

**Returns**

An object containing cost breakdown information.

**Example**

```typescript
// Quote position creation cost
const quote = await dlmmPool.quoteCreatePosition({
  strategy: {
    minBinId: 8388600,
    maxBinId: 8388620,
    strategyType: StrategyType.SpotBalanced,
  }
});
```

**Notes**

* The function `quoteCreatePosition` is used to quote the cost of creating a position with a given strategy.

***

### createEmptyPosition

Creates an empty position and initializes the corresponding bin arrays if needed.

**Function**

```typescript
async createEmptyPosition({
    positionPubKey,
    minBinId,
    maxBinId,
    user,
}: {
    positionPubKey: PublicKey;
    minBinId: number;
    maxBinId: number;
    user: PublicKey;
})
```

**Parameters**

```typescript
positionPubKey: PublicKey     // The public key of the position account
minBinId: number              // Lower bin ID of the position
maxBinId: number              // Upper bin ID of the position
user: PublicKey               // The public key of the user account
```

**Returns**

A transaction for creating the empty position.

**Example**

```typescript
const positionKeypair = Keypair.generate();
const createTx = await dlmmPool.createEmptyPosition({
  positionPubKey: positionKeypair.publicKey,
  minBinId: 8388600,
  maxBinId: 8388620,
  user: userPublicKey
});
```

**Notes**

* The function `createEmptyPosition` is used to create an empty position with specified min/max bin IDs.

***

### seedLiquidity

Creates multiple grouped instructions. The grouped instructions will be \[init ata + send lamport for token provde], \[initialize bin array + initialize position instructions] and \[deposit instruction]. Each grouped instructions can be executed parallelly.

**Function**

```typescript
async seedLiquidity(
    owner: PublicKey,
    seedAmount: BN,
    curvature: number,
    minPrice: number,
    maxPrice: number,
    base: PublicKey,
    payer: PublicKey,
    feeOwner: PublicKey,
    operator: PublicKey,
    lockReleasePoint: BN,
    shouldSeedPositionOwner: boolean = false
): Promise<SeedLiquidityResponse>
```

**Parameters**

```typescript
owner: PublicKey              // The public key of the positions owner
seedAmount: BN                // Lamport amount to be seeded to the pool
curvature: number             // Distribution curvature parameter
minPrice: number              // Start price in UI format
maxPrice: number              // End price in UI format
base: PublicKey               // Base key for position derivation
payer: PublicKey              // Account rental fee payer
feeOwner: PublicKey           // Fee owner key
operator: PublicKey           // Operator key
lockReleasePoint: BN          // Timelock point for position withdrawal
shouldSeedPositionOwner?: boolean // Whether to send token to position owner
```

**Returns**

A SeedLiquidityResponse containing grouped instructions and cost breakdown.

**Example**

```typescript
const curvature = 0.6;
const minPrice = 0.000001;
const maxPrice = 0.00003;

const currentSlot = await connection.getSlot();
const lockDuration = new BN(86400 * 31);
const lockReleaseSlot = lockDuration.add(new BN(currentSlot));

const seedResponse = await dlmmPool.seedLiquidity(
  ownerPublicKey,
  new BN(200_000_000_000), 
  curvature, 
  minPrice, 
  maxPrice, 
  baseKeypair.publicKey,
  payerPublicKey,
  feeOwnerPublicKey,
  operatorPublicKey,
  lockReleaseSlot,
  true 
);
```

**Notes**

* `owner`: The public key of the positions owner.
* `seedAmount`: Lamport amount to be seeded to the pool.
* `minPrice`: Start price in UI format
* `maxPrice`: End price in UI format
* `base`: Base key
* `txPayer`: Account rental fee payer
* `feeOwner`: Fee owner key. Default to position owner
* `operator`: Operator key
* `lockReleasePoint`: Timelock. Point (slot/timestamp) the position can withdraw the liquidity,
* `shouldSeedPositionOwner` (optional): Whether to send 1 lamport amount of token X to the position owner to prove ownership.

***

### seedLiquiditySingleBin

Seeds liquidity into a single bin at a specific price.

**Function**

```typescript
async seedLiquiditySingleBin(
    payer: PublicKey,
    base: PublicKey,
    seedAmount: BN,
    price: number,
    roundingUp: boolean,
    positionOwner: PublicKey,
    feeOwner: PublicKey,
    operator: PublicKey,
    lockReleasePoint: BN,
    shouldSeedPositionOwner: boolean = false
): Promise<SeedLiquiditySingleBinResponse>
```

**Parameters**

```typescript
payer: PublicKey              // The public key of the tx payer
base: PublicKey               // Base key for position derivation
seedAmount: BN                // Token X lamport amount to be seeded
price: number                 // TokenX/TokenY Price in UI format
roundingUp: boolean           // Whether to round up the price
positionOwner: PublicKey      // The owner of the position
feeOwner: PublicKey           // Position fee owner
operator: PublicKey           // Operator of the position
lockReleasePoint: BN          // The lock release point of the position
shouldSeedPositionOwner?: boolean // Whether to send token to position owner
```

**Returns**

A SeedLiquiditySingleBinResponse containing instructions and cost breakdown.

**Example**

```typescript
const initialPrice = 0.000001;

const seedResponse = await dlmmPool.seedLiquiditySingleBin(
  payerPublicKey,
  baseKeypair.publicKey,
  new BN(1000000), 
  initialPrice, 
  true,
  ownerPublicKey,
  feeOwnerPublicKey,
  operatorPublicKey,
  new BN(Date.now() / 1000 + 86400) 
);
```

**Notes**

* `payer`: The public key of the tx payer.
* `base`: Base key
* `seedAmount`: Token X lamport amount to be seeded to the pool.
* `price`: TokenX/TokenY Price in UI format
* `roundingUp`: Whether to round up the price
* `positionOwner`: The owner of the position
* `feeOwner`: Position fee owner
* `operator`: Operator of the position. Operator able to manage the position on behalf of the position owner. However, liquidity withdrawal issue by the operator can only send to the position owner.
* `lockReleasePoint`: The lock release point of the position.
* `shouldSeedPositionOwner` (optional): Whether to send 1 lamport amount of token X to the position owner to prove ownership.

***

### initializeBinArrays

Initializes bin arrays for the given bin array indexes if they weren't initialized.

**Function**

```typescript
async initializeBinArrays(binArrayIndexes: BN[], funder: PublicKey)
```

**Parameters**

```typescript
binArrayIndexes: BN[]         // Array of bin array indexes to initialize
funder: PublicKey             // The public key of the funder
```

**Returns**

Array of transaction instructions to initialize the bin arrays.

**Example**

```typescript
// Initialize specific bin arrays
const binArrayIndexes = [new BN(-1), new BN(0), new BN(1)];
const instructions = await dlmmPool.initializeBinArrays(
  binArrayIndexes,
  funderPublicKey
);
```

**Notes**

* The function `initializeBinArrays` is used to initialize bin arrays for the given bin array indexes if they weren't initialized.

***

### initializePositionByOperator

Initializes a position with an operator that can manage it on behalf of the owner.

**Function**

```typescript
async initializePositionByOperator({
    lowerBinId,
    positionWidth,
    owner,
    feeOwner,
    base,
    operator,
    payer,
    lockReleasePoint,
}: {
    lowerBinId: BN;
    positionWidth: BN;
    owner: PublicKey;
    feeOwner: PublicKey;
    operator: PublicKey;
    payer: PublicKey;
    base: PublicKey;
    lockReleasePoint: BN;
}): Promise<Transaction>
```

**Parameters**

```typescript
lowerBinId: BN                // Lower bin ID of the position
positionWidth: BN             // Width of the position
owner: PublicKey              // Owner of the position
feeOwner: PublicKey           // Owner of the fees earned by the position
operator: PublicKey           // Operator of the position
payer: PublicKey              // Payer for the position account rental
base: PublicKey               // Base key for position derivation
lockReleasePoint: BN          // The lock release point of the position
```

**Returns**

A transaction for initializing the position by operator.

**Example**

```typescript
const initTx = await dlmmPool.initializePositionByOperator({
  lowerBinId: new BN(5660),
  positionWidth: MAX_BIN_PER_POSITION,
  owner: ownerPublicKey,
  feeOwner: feeOwnerPublicKey,
  operator: operatorPublicKey,
  payer: payerPublicKey,
  base: baseKeypair.publicKey,
  lockReleasePoint: new BN(Date.now() / 1000 + 86400)
});
```

**Notes**

* `lowerBinId`: Lower bin ID of the position. This represent the lowest price of the position
* `positionWidth`: Width of the position. This will decide the upper bin id of the position, which represents the highest price of the position. UpperBinId = lowerBinId + positionWidth
* `owner`: Owner of the position.
* `operator`: Operator of the position. Operator able to manage the position on behalf of the position owner. However, liquidity withdrawal issue by the operator can only send to the position owner.
* `base`: Base key
* `feeOwner`: Owner of the fees earned by the position.
* `payer`: Payer for the position account rental.
* `lockReleasePoint`: The lock release point of the position.

***

### setPairStatusPermissionless

Sets the status of a permissionless LB pair to either enabled or disabled.

**Function**

```typescript
async setPairStatusPermissionless(
    enable: boolean,
    creator: PublicKey
)
```

**Parameters**

```typescript
enable: boolean               // If true, enables the pair; if false, disables it
creator: PublicKey            // The public key of the pool creator
```

**Returns**

A transaction for setting the pair status.

**Example**

```typescript
const statusTx = await dlmmPool.setPairStatusPermissionless(
  true, 
  creatorPublicKey
);
```

**Notes**

* Requires `creator_pool_on_off_control` to be true and type `CustomizablePermissionless`
* Pool creator can enable/disable anytime before activation
* After activation, creator can only enable the pair

***

### setActivationPoint

Sets the activation point for the LB pair.

**Function**

```typescript
async setActivationPoint(activationPoint: BN)
```

**Parameters**

```typescript
activationPoint: BN           // The activation point (timestamp/slot)
```

**Returns**

A transaction for setting the activation point.

**Example**

```typescript
const activationTx = await dlmmPool.setActivationPoint(
  new BN(Date.now() / 1000 + 3600)
);
```

**Notes**

* The function `setActivationPoint` is used to set the activation point for the LB pair.

***

### setPairStatus

Sets the pair status (enabled/disabled) for admin-controlled pairs.

**Function**

```typescript
async setPairStatus(enabled: boolean): Promise<Transaction>
```

**Parameters**

```typescript
enabled: boolean              // Whether to enable or disable the pair
```

**Returns**

A transaction for setting the pair status.

**Example**

```typescript
const statusTx = await dlmmPool.setPairStatus(true); // enable
```

**Notes**

* The function `setPairStatus` is used to set the pair status for admin-controlled pairs.

***

## State Functions

### getLbPairs

Retrieves all LB pair accounts for the DLMM program.

**Function**

```typescript
static async getLbPairs(
    connection: Connection,
    opt?: Opt
): Promise<LbPairAccount[]>
```

**Parameters**

```typescript
connection: Connection        // Solana connection instance
opt?: Opt                     // Optional cluster and program ID
```

**Returns**

An array of LB pair account objects.

**Example**

```typescript
const allPairs = await DLMM.getLbPairs(connection);
```

**Notes**

* The function `getLbPairs` is used to retrieve all LB pair accounts for the DLMM program.

***

### getCustomizablePermissionlessLbPairIfExists

Retrieves the public key of a customizable permissionless LB pair if it exists.

**Function**

```typescript
static async getCustomizablePermissionlessLbPairIfExists(
    connection: Connection,
    tokenX: PublicKey,
    tokenY: PublicKey,
    opt?: Opt
): Promise<PublicKey | null>
```

**Parameters**

```typescript
connection: Connection        // Solana connection instance
tokenX: PublicKey             // Token X mint address
tokenY: PublicKey             // Token Y mint address
opt?: Opt                     // Optional parameters
```

**Returns**

Public key of the pair if it exists, null otherwise.

**Example**

```typescript
const WEN = new PublicKey('WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk')
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')

const pairPubkey = await DLMM.getCustomizablePermissionlessLbPairIfExists(
  connection,
  WEN,
  USDC,
  {
    cluster: "localhost",
  }
);
```

***

### getPosition

Retrieves position information for a given position public key.

**Function**

```typescript
async getPosition(positionPubKey: PublicKey): Promise<LbPosition>
```

**Parameters**

```typescript
positionPubKey: PublicKey     // The public key of the position account
```

**Returns**

An LbPosition object containing position data and metadata.

**Example**

```typescript
const position = await dlmmPool.getPosition(positionPublicKey);
```

**Notes**

* The function `getPosition` retrieves position information for a given public key and processes it using various data to return a `LbPosition` object.

***

### getAllPresetParameters

Retrieves all preset parameter accounts for the DLMM program.

**Function**

```typescript
static async getAllPresetParameters(
    connection: Connection, 
    opt?: Opt
): Promise<{
    presetParameter: PresetParameterAccount[];
    presetParameter2: PresetParameter2Account[];
}>
```

**Parameters**

```typescript
connection: Connection         // Solana connection instance
opt?: Opt                     // Optional cluster and program ID
```

**Returns**

An object containing preset parameter accounts.

**Example**

```typescript
const presetParams = await DLMM.getAllPresetParameters(connection);
```

**Notes**

* The function `getAllPresetParameters` is used to retrieve all preset parameter accounts for the DLMM program.

***

### getAllLbPairPositionsByUser

Retrieves all LB pair positions for a given user.

**Function**

```typescript
static async getAllLbPairPositionsByUser(
    connection: Connection,
    userPubKey: PublicKey,
    opt?: Opt
): Promise<Map<string, PositionInfo>>
```

**Parameters**

```typescript
connection: Connection         // Solana connection instance
userPubKey: PublicKey         // The user's wallet public key
opt?: Opt                     // Optional cluster and program ID
```

**Returns**

A Map containing LB pair addresses and their position information.

**Example**

```typescript
// Get all positions for a user
const userPositions = await DLMM.getAllLbPairPositionsByUser(
  connection,
  userPublicKey
);

userPositions.forEach((positionInfo, lbPairAddress) => {
  console.log(`Positions in pool ${lbPairAddress}:`, positionInfo);
});
```

**Notes**

* The function `getAllLbPairPositionsByUser` is used to retrieve all LB pair positions for a given user.

***

### refetchStates

Refetches and updates the current state of the DLMM instance.

**Function**

```typescript
async refetchStates(): Promise<void>
```

**Parameters**

None.

**Returns**

Promise that resolves when states are updated.

**Example**

```typescript
await dlmmPool.refetchStates();
console.log('Updated active bin:', dlmmPool.lbPair.activeId);
```

**Notes**

* The function `refetchStates` is used to refetch and update the current state of the DLMM instance.

***

### getBinArrays

Returns all bin arrays for the current LB pair.

**Function**

```typescript
async getBinArrays(): Promise<BinArrayAccount[]>
```

**Parameters**

None.

**Returns**

Array of bin array accounts.

**Example**

```typescript
const binArrays = await dlmmPool.getBinArrays();
```

**Notes**

* The function `getBinArrays` is used to retrieve all bin arrays for the current LB pair.

***

### getBinArrayForSwap

Retrieves bin arrays needed for a swap operation.

**Function**

```typescript
async getBinArrayForSwap(
    swapForY: boolean,
    count = 4
): Promise<BinArrayAccount[]>
```

**Parameters**

```typescript
swapForY: boolean             // Direction of swap (true for X to Y)
count?: number                // Number of bin arrays to retrieve (default: 4)
```

**Returns**

Array of bin array accounts for the swap.

**Example**

```typescript
const binArrays = await dlmmPool.getBinArrayForSwap(true, 5);
```

**Notes**

* The function `getBinArrayAroundActiveBin` retrieves a specified number of `BinArrayAccount` objects from the blockchain, based on the active bin and its surrounding bin arrays.

***

### getFeeInfo

Calculates and returns fee information for the pool.

**Function**

```typescript
getFeeInfo(): FeeInfo
```

**Parameters**

None.

**Returns**

FeeInfo object containing fee percentages.

**Example**

```typescript
const feeInfo = dlmmPool.getFeeInfo();
console.log('Base fee rate:', feeInfo.baseFeeRatePercentage.toString());
console.log('Max fee rate:', feeInfo.maxFeeRatePercentage.toString());
console.log('Protocol fee:', feeInfo.protocolFeePercentage.toString());
```

**Notes**

* The function `getFeeInfo` calculates and returns the base fee rate percentage, maximum fee rate percentage, and protocol fee percentage.

***

### getDynamicFee

Calculates the current dynamic fee for the pool.

**Function**

```typescript
getDynamicFee(): Decimal
```

**Parameters**

None.

**Returns**

Current dynamic fee as a Decimal percentage.

**Example**

```typescript
const dynamicFee = dlmmPool.getDynamicFee();
console.log('Current dynamic fee:', dynamicFee.toString(), '%');
```

**Notes**

* The function `getDynamicFee` retrieves the current dynamic fee for the pool.

***

### getEmissionRate

Returns the emission rates for LM rewards.

**Function**

```typescript
getEmissionRate(): EmissionRate
```

**Parameters**

None.

**Returns**

An EmissionRate object containing reward emission rates.

**Example**

```typescript
const emissionRate = dlmmPool.getEmissionRate();
console.log('Reward one rate:', emissionRate.rewardOne?.toString());
console.log('Reward two rate:', emissionRate.rewardTwo?.toString());
```

**Notes**

* The function `getEmissionRate` retrieves the emission rates for LM rewards.

***

### getBinsAroundActiveBin

Retrieves bins around the active bin within specified ranges.

**Function**

```typescript
async getBinsAroundActiveBin(
    numberOfBinsToTheLeft: number,
    numberOfBinsToTheRight: number
): Promise<{ activeBin: number; bins: BinLiquidity[] }>
```

**Parameters**

```typescript
numberOfBinsToTheLeft: number  // Number of bins to retrieve on the left
numberOfBinsToTheRight: number // Number of bins to retrieve on the right
```

**Returns**

Object containing the active bin ID and array of bin liquidity data.

**Example**

```typescript
const { activeBin, bins } = await dlmmPool.getBinsAroundActiveBin(10, 10);
console.log('Active bin:', activeBin);
console.log('Total bins:', bins.length);
```

**Notes**

* The function `getBinsAroundActiveBin` retrieves a specified number of bins to the left and right of the active bin and returns them along with the active bin ID.

***

### getBinsBetweenMinAndMaxPrice

Retrieves bins within a specified price range.

**Function**

```typescript
async getBinsBetweenMinAndMaxPrice(
    minPrice: number,
    maxPrice: number
): Promise<{ activeBin: number; bins: BinLiquidity[] }>
```

**Parameters**

```typescript
minPrice: number              // Minimum price for filtering bins
maxPrice: number              // Maximum price for filtering bins
```

**Returns**

Object containing the active bin ID and filtered bin liquidity data.

**Example**

```typescript
const result = await dlmmPool.getBinsBetweenMinAndMaxPrice(1.0, 1.2);
console.log('Bins in price range:', result.bins.length);
```

**Notes**

* The function `getBinsBetweenMinAndMaxPrice` retrieves a list of bins within a specified price range.

***

### getBinsBetweenLowerAndUpperBound

Retrieves bins between specified bin IDs.

**Function**

```typescript
async getBinsBetweenLowerAndUpperBound(
    lowerBinId: number,
    upperBinId: number,
    lowerBinArray?: BinArray,
    upperBinArray?: BinArray
): Promise<{ activeBin: number; bins: BinLiquidity[] }>
```

**Parameters**

```typescript
lowerBinId: number            // Lower bound bin ID
upperBinId: number            // Upper bound bin ID
lowerBinArray?: BinArray      // Optional cached lower bin array
upperBinArray?: BinArray      // Optional cached upper bin array
```

**Returns**

Object containing the active bin ID and bin liquidity data in the range.

**Example**

```typescript
const result = await dlmmPool.getBinsBetweenLowerAndUpperBound(
  8388600, 8388620
);
```

**Notes**

* The function `getBinsBetweenLowerAndUpperBound` retrieves a list of bins between a lower and upper bin ID and returns the active bin ID and the list of bins.

***

### getActiveBin

Retrieves information about the currently active bin.

**Function**

```typescript
async getActiveBin(): Promise<BinLiquidity>
```

**Parameters**

None.

**Returns**

BinLiquidity object for the active bin.

**Example**

```typescript
const activeBin = await dlmmPool.getActiveBin();
console.log('Active bin ID:', activeBin.binId);
console.log('Active bin price:', activeBin.pricePerToken);
```

**Notes**

* The function retrieves the active bin ID and its corresponding price.

***

### getPositionsByUserAndLbPair

Retrieves positions by user for the current LB pair.

**Function**

```typescript
async getPositionsByUserAndLbPair(
    userPubKey?: PublicKey
): Promise<{
    activeBin: BinLiquidity;
    userPositions: Array<LbPosition>;
}>
```

**Parameters**

```typescript
userPubKey?: PublicKey        // Optional user public key
```

**Returns**

Object containing active bin and user positions.

**Example**

```typescript
// Get user positions for this pool
const result = await dlmmPool.getPositionsByUserAndLbPair(userPublicKey);
console.log('User has', result.userPositions.length, 'positions');
console.log('Active bin:', result.activeBin.binId);
```

**Notes**

* The function `getPositionsByUserAndLbPair` retrieves positions by user and LB pair, including active bin and user positions.

***

### getPairPubkeyIfExists

Retrieves the public key of an LB pair if it exists.

**Function**

```typescript
static async getPairPubkeyIfExists(
    connection: Connection,
    tokenX: PublicKey,
    tokenY: PublicKey,
    binStep: BN,
    baseFactor: BN,
    baseFeePowerFactor: BN,
    opt?: Opt
): Promise<PublicKey | null>
```

**Parameters**

```typescript
connection: Connection         // Solana connection instance
tokenX: PublicKey             // Token X mint address
tokenY: PublicKey             // Token Y mint address
binStep: BN                   // Bin step of the pair
baseFactor: BN                // Base factor of the pair
baseFeePowerFactor: BN        // Base fee power factor
opt?: Opt                     // Optional parameters
```

**Returns**

Public key of the pair if it exists, null otherwise.

**Example**

```typescript
const dlmm = await DLMM.create(connection, pairKey, opt);
const pairPubkey = await DLMM.getPairPubkeyIfExists(
  connection,
  dlmm.lbPair.tokenXMint,
  dlmm.lbPair.tokenYMint,
  new BN(dlmm.lbPair.binStep),
  new BN(dlmm.lbPair.parameters.baseFactor),
  new BN(dlmm.lbPair.parameters.baseFeePowerFactor),
);
```

**Notes**

* The function `getPairPubkeyIfExists` retrieves the public key of an LB pair if it exists.

***

### getMaxPriceInBinArrays

Gets the maximum price from the provided bin arrays.

**Function**

```typescript
async getMaxPriceInBinArrays(
    binArrayAccounts: BinArrayAccount[]
): Promise<string>
```

**Parameters**

```typescript
binArrayAccounts: BinArrayAccount[] // Array of bin array accounts
```

**Returns**

Maximum price as a string.

**Example**

```typescript
const binArrays = await dlmmPool.getBinArrays();
const maxPrice = await dlmmPool.getMaxPriceInBinArrays(binArrays);
console.log('Maximum price:', maxPrice);
```

**Notes**

* The function `getMaxPriceInBinArrays` retrieves the maximum price from the provided bin arrays.

***

### getLbPairLockInfo

Retrieves all pair positions that have locked liquidity.

**Function**

```typescript
async getLbPairLockInfo(
    lockDurationOpt?: number
): Promise<PairLockInfo>
```

**Parameters**

```typescript
lockDurationOpt?: number      // Minimum position lock duration to filter by
```

**Returns**

A PairLockInfo object containing information about locked positions.

**Example**

```typescript
const lockInfo = await dlmmPool.getLbPairLockInfo(86400); // 1 day minimum
console.log('Locked positions:', lockInfo.positions.length);

lockInfo.positions.forEach(pos => {
  console.log('Position:', pos.positionAddress.toString());
  console.log('Lock release:', pos.lockReleasePoint);
});
```

**Notes**

* The function `getLbPairLockInfo` retrieves all pair positions that have locked liquidity.

***

### canSyncWithMarketPrice

Checks if the pool can sync with a given market price.

**Function**

```typescript
canSyncWithMarketPrice(marketPrice: number, activeBinId: number)
```

**Parameters**

```typescript
marketPrice: number           // Market price to check sync compatibility
activeBinId: number           // Current active bin ID
```

**Returns**

Boolean indicating if sync is possible.

**Example**

```typescript
// Check if can sync with market price
const activeBin = await dlmmPool.getActiveBin();
const canSync = dlmmPool.canSyncWithMarketPrice(1.05, activeBin.binId);

if (canSync) {
  console.log('Can sync with market price');
} else {
  console.log('Cannot sync - liquidity exists between current and market price');
}
```

**Notes**

* The function `canSyncWithMarketPrice` checks if the pool can sync with a given market price.

***

### isSwapDisabled

Checks if swapping is disabled for a given swap initiator.

**Function**

```typescript
isSwapDisabled(swapInitiator: PublicKey)
```

**Parameters**

```typescript
swapInitiator: PublicKey      // Address of the swap initiator
```

**Returns**

Boolean indicating if swap is disabled for the initiator.

**Example**

```typescript
const isDisabled = dlmmPool.isSwapDisabled(userPublicKey);

if (isDisabled) {
  console.log('Swap is disabled for this user');
} else {
  console.log('Swap is enabled');
}
```

**Notes**

* Returns true if pair status is disabled
* For permissioned pairs, checks activation time and pre-activation settings
* Considers special pre-activation swap addresses

***

## Helper Functions

### syncWithMarketPrice

Synchronizes the pool with a given market price.

**Function**

```typescript
async syncWithMarketPrice(
    marketPrice: number, 
    owner: PublicKey
): Promise<Transaction>
```

**Parameters**

```typescript
marketPrice: number           // Market price to sync with
owner: PublicKey              // Owner of the transaction
```

**Returns**

Transaction for syncing with market price.

**Example**

```typescript
const syncTx = await dlmmPool.syncWithMarketPrice(1.05, userPublicKey);
```

**Notes**

* The `syncWithMarketPrice` function is used to sync the liquidity pool with the market price.

***

### toPricePerLamport

Converts a real price of bin to a lamport value

**Function**

```typescript
toPricePerLamport(price: number): string
```

**Parameters**

```typescript
price: number                 // Real price to convert
```

**Returns**

Price per lamport as a string.

**Example**

```typescript
const pricePerLamport = dlmmPool.toPricePerLamport(1.05);
console.log('Price per lamport:', pricePerLamport);
```

**Notes**

* The `toPricePerLamport` function is used to convert a real price of bin to a lamport value.

***

### fromPricePerLamport

Converts a price per lamport value to a real price of bin

**Function**

```typescript
fromPricePerLamport(pricePerLamport: number): string
```

**Parameters**

```typescript
pricePerLamport: number       // Price per lamport to convert
```

**Returns**

Real price as a string.

**Example**

```typescript
const realPrice = dlmmPool.fromPricePerLamport(1050000);
console.log('Real price:', realPrice);
```

**Notes**

* The `fromPricePerLamport` function is used to convert a price per lamport value to a real price of bin.
