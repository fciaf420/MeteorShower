# DLMM Formulas

DLMM is a concentrated liquidity AMM that uses a dynamic fee mechanism to adjust liquidity based on market conditions.

# Price Calculation Formulas

## Base Price Formula

```math
\text{price} = \left(1 + \frac{\text{bin\_step}}{\text{BASIS\_POINT\_MAX}}\right)^{\text{active\_id}}
```

**Where:**

* `BASIS_POINT_MAX` = 10,000
* Uses Q64.64 fixed-point arithmetic
* Example: For `bin_step = 10`, `price = (1.001)^active_id`

## Price Impact Formulas

**Selling X for Y:**

```math
\text{min\_price} = \text{spot\_price} \times \frac{\text{BASIS\_POINT\_MAX} - \text{max\_price\_impact\_bps}}{\text{BASIS\_POINT\_MAX}}
```

**Selling Y for X:**

```math
\text{min\_price} = \text{spot\_price} \times \frac{\text{BASIS\_POINT\_MAX}}{\text{BASIS\_POINT\_MAX} - \text{max\_price\_impact\_bps}}
```

## Fee Calculation Formulas

### Total Trading Fee

```math
\text{total\_fee\_rate} = \min(\text{base\_fee\_rate} + \text{variable\_fee\_rate}, \text{MAX\_FEE\_RATE})
```

#### Base Fee Formula

```math
\text{base\_fee\_rate} = \text{base\_factor} \times \text{bin\_step} \times 10 \times 10^{\text{base\_fee\_power\_factor}}
```

#### Variable Fee Formula

```math
\text{variable\_fee\_rate} = \frac{(\text{volatility\_accumulator} \times \text{bin\_step})^2 \times \text{variable\_fee\_control} + \text{OFFSET}}{\text{SCALE}}
```

**Where:**

* `OFFSET` = 99,999,999,999
* `SCALE` = 100,000,000,000

#### Composition Fee Formula

```math
\text{composition\_fee} = \frac{\text{swap\_amount} \times \text{total\_fee\_rate} \times (1 + \text{total\_fee\_rate})}{\text{FEE\_PRECISION}^2}
```

**Where:**

* `MAX_FEE_RATE` = 100,000,000

## Liquidity and Bin Math Formulas

### Liquidity Formula (Constant Sum)

```math
L = \text{price} \times x + y
```

**Where:**

* `L` is liquidity
* `x` and `y` are token amounts
* Price is in Q64.64 format

### Liquidity Share Formula

```math
\text{liquidity\_share} = \frac{\text{in\_liquidity} \times \text{liquidity\_supply}}{\text{bin\_liquidity}}
```
