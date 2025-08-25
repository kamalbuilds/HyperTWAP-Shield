const { ethers } = require("hardhat");

/**
 * Mock Oracle Utility for Testing
 * Simulates oracle responses with configurable price feeds and market conditions
 */
class MockOracle {
    constructor() {
        this.prices = new Map();
        this.priceHistory = new Map();
        this.volatilityFactors = new Map();
        this.updateCallbacks = [];
        this.isActive = true;
    }

    /**
     * Set price for an asset
     */
    async setPrice(asset, price) {
        const previousPrice = this.prices.get(asset) || 0n;
        this.prices.set(asset, price);
        
        // Store price history
        if (!this.priceHistory.has(asset)) {
            this.priceHistory.set(asset, []);
        }
        this.priceHistory.get(asset).push({
            price,
            timestamp: Math.floor(Date.now() / 1000),
            blockNumber: await ethers.provider.getBlockNumber()
        });

        // Trigger callbacks
        this.updateCallbacks.forEach(callback => {
            callback(asset, price, previousPrice);
        });

        return { previousPrice, newPrice: price };
    }

    /**
     * Get current price for an asset
     */
    getPrice(asset) {
        return this.prices.get(asset) || 0n;
    }

    /**
     * Simulate price movement with volatility
     */
    simulatePriceMovement(asset, basePrice, volatilityPercent = 2, duration = 3600) {
        const movements = [];
        const steps = Math.floor(duration / 60); // 1-minute intervals
        let currentPrice = basePrice;

        for (let i = 0; i < steps; i++) {
            // Random walk with mean reversion
            const randomFactor = (Math.random() - 0.5) * 2; // -1 to 1
            const volatilityFactor = volatilityPercent / 100;
            const meanReversion = (basePrice - currentPrice) / basePrice * 0.1; // 10% reversion strength
            
            const priceChange = currentPrice * BigInt(Math.floor((randomFactor * volatilityFactor + meanReversion) * 1e6)) / 1000000n;
            currentPrice += priceChange;
            
            // Ensure price doesn't go negative or too extreme
            if (currentPrice < basePrice / 10n) currentPrice = basePrice / 10n;
            if (currentPrice > basePrice * 10n) currentPrice = basePrice * 10n;

            movements.push({
                timestamp: Math.floor(Date.now() / 1000) + i * 60,
                price: currentPrice,
                change: priceChange,
                changePercent: Number(priceChange * 10000n / (currentPrice - priceChange)) / 100
            });
        }

        return movements;
    }

    /**
     * Simulate different market conditions
     */
    simulateMarketCondition(asset, basePrice, condition, duration = 3600) {
        const movements = [];
        const steps = Math.floor(duration / 60);
        let currentPrice = basePrice;

        for (let i = 0; i < steps; i++) {
            let priceMultiplier = 1;

            switch (condition) {
                case 'bull_run':
                    // Steady upward trend with occasional dips
                    priceMultiplier = 1 + (Math.random() * 0.02 + 0.005); // 0.5-2.5% up
                    if (Math.random() < 0.1) priceMultiplier = 1 - Math.random() * 0.01; // 10% chance of small dip
                    break;

                case 'bear_market':
                    // Steady downward trend with occasional pumps
                    priceMultiplier = 1 - (Math.random() * 0.02 + 0.005); // 0.5-2.5% down
                    if (Math.random() < 0.1) priceMultiplier = 1 + Math.random() * 0.01; // 10% chance of small pump
                    break;

                case 'high_volatility':
                    // Large swings in both directions
                    priceMultiplier = 1 + (Math.random() - 0.5) * 0.1; // ±5%
                    break;

                case 'sideways':
                    // Low volatility, mean reversion
                    const meanReversion = (basePrice - currentPrice) / basePrice * 0.05;
                    priceMultiplier = 1 + meanReversion + (Math.random() - 0.5) * 0.005; // ±0.25%
                    break;

                case 'flash_crash':
                    // Sudden drop followed by recovery
                    if (i === Math.floor(steps * 0.3)) {
                        priceMultiplier = 0.85; // 15% crash
                    } else if (i > Math.floor(steps * 0.3) && i < Math.floor(steps * 0.7)) {
                        priceMultiplier = 1 + Math.random() * 0.05; // Recovery
                    } else {
                        priceMultiplier = 1 + (Math.random() - 0.5) * 0.01; // Normal volatility
                    }
                    break;

                case 'pump_and_dump':
                    // Rapid rise followed by rapid fall
                    if (i < Math.floor(steps * 0.2)) {
                        priceMultiplier = 1 + Math.random() * 0.1; // Pump phase
                    } else if (i < Math.floor(steps * 0.5)) {
                        priceMultiplier = 1 - Math.random() * 0.08; // Dump phase
                    } else {
                        priceMultiplier = 1 + (Math.random() - 0.5) * 0.02; // Stabilization
                    }
                    break;

                default:
                    priceMultiplier = 1 + (Math.random() - 0.5) * 0.02; // Default ±1%
            }

            currentPrice = currentPrice * BigInt(Math.floor(priceMultiplier * 1e6)) / 1000000n;
            
            movements.push({
                timestamp: Math.floor(Date.now() / 1000) + i * 60,
                price: currentPrice,
                condition
            });
        }

        return movements;
    }

    /**
     * Add callback for price updates
     */
    onPriceUpdate(callback) {
        this.updateCallbacks.push(callback);
    }

    /**
     * Get price history for an asset
     */
    getPriceHistory(asset, fromTimestamp = 0) {
        const history = this.priceHistory.get(asset) || [];
        return history.filter(entry => entry.timestamp >= fromTimestamp);
    }

    /**
     * Calculate TWAP for a period
     */
    calculateTWAP(asset, fromTimestamp, toTimestamp) {
        const history = this.getPriceHistory(asset, fromTimestamp);
        const relevantHistory = history.filter(entry => 
            entry.timestamp >= fromTimestamp && entry.timestamp <= toTimestamp
        );

        if (relevantHistory.length === 0) return 0n;

        let weightedSum = 0n;
        let totalWeight = 0n;

        for (let i = 0; i < relevantHistory.length; i++) {
            const entry = relevantHistory[i];
            const nextEntry = relevantHistory[i + 1];
            
            const weight = nextEntry 
                ? BigInt(nextEntry.timestamp - entry.timestamp)
                : BigInt(toTimestamp - entry.timestamp);
            
            weightedSum += entry.price * weight;
            totalWeight += weight;
        }

        return totalWeight > 0n ? weightedSum / totalWeight : 0n;
    }

    /**
     * Simulate oracle failure scenarios
     */
    simulateFailure(type, duration = 60) {
        switch (type) {
            case 'offline':
                this.isActive = false;
                setTimeout(() => { this.isActive = true; }, duration * 1000);
                break;

            case 'stale_price':
                // Stop updating prices for duration
                const originalCallbacks = [...this.updateCallbacks];
                this.updateCallbacks = [];
                setTimeout(() => { 
                    this.updateCallbacks = originalCallbacks; 
                }, duration * 1000);
                break;

            case 'zero_price':
                // Return zero prices temporarily
                const originalPrices = new Map(this.prices);
                for (const [asset] of this.prices) {
                    this.prices.set(asset, 0n);
                }
                setTimeout(() => {
                    this.prices = originalPrices;
                }, duration * 1000);
                break;

            case 'extreme_price':
                // Return extreme prices
                const extremePrices = new Map(this.prices);
                for (const [asset, price] of this.prices) {
                    this.prices.set(asset, price * 1000n); // 1000x price
                }
                setTimeout(() => {
                    this.prices = extremePrices;
                }, duration * 1000);
                break;
        }
    }

    /**
     * Generate realistic market scenarios for testing
     */
    generateScenario(name, basePrice, duration = 3600) {
        const scenarios = {
            'normal_trading': () => this.simulatePriceMovement(1, basePrice, 1.5, duration),
            'high_volatility_day': () => this.simulatePriceMovement(1, basePrice, 5, duration),
            'trending_up': () => this.simulateMarketCondition(1, basePrice, 'bull_run', duration),
            'trending_down': () => this.simulateMarketCondition(1, basePrice, 'bear_market', duration),
            'sideways_market': () => this.simulateMarketCondition(1, basePrice, 'sideways', duration),
            'flash_crash_event': () => this.simulateMarketCondition(1, basePrice, 'flash_crash', duration),
            'manipulation_attempt': () => this.simulateMarketCondition(1, basePrice, 'pump_and_dump', duration)
        };

        return scenarios[name] ? scenarios[name]() : scenarios['normal_trading']();
    }

    /**
     * Reset oracle state
     */
    reset() {
        this.prices.clear();
        this.priceHistory.clear();
        this.volatilityFactors.clear();
        this.updateCallbacks = [];
        this.isActive = true;
    }

    /**
     * Get oracle statistics
     */
    getStatistics(asset) {
        const history = this.priceHistory.get(asset) || [];
        if (history.length === 0) return null;

        const prices = history.map(h => Number(h.price));
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        
        // Calculate volatility (standard deviation)
        const variance = prices.reduce((sum, price) => sum + Math.pow(price - avg, 2), 0) / prices.length;
        const volatility = Math.sqrt(variance);

        return {
            asset,
            currentPrice: this.prices.get(asset) || 0n,
            minPrice: min,
            maxPrice: max,
            averagePrice: avg,
            volatility,
            volatilityPercent: (volatility / avg) * 100,
            priceCount: history.length,
            timeSpan: history.length > 1 ? history[history.length - 1].timestamp - history[0].timestamp : 0
        };
    }
}

module.exports = { MockOracle };