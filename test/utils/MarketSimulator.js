const { ethers } = require("hardhat");

/**
 * Market Simulator for Advanced TWAP Testing
 * Simulates realistic market conditions and trading scenarios
 */
class MarketSimulator {
    constructor() {
        this.assets = new Map();
        this.marketMakers = new Map();
        this.orderBook = new Map();
        this.tradeHistory = [];
        this.currentTime = Math.floor(Date.now() / 1000);
        this.marketConditions = 'normal';
    }

    /**
     * Initialize an asset with base parameters
     */
    addAsset(assetId, config = {}) {
        const defaultConfig = {
            symbol: `ASSET_${assetId}`,
            basePrice: ethers.parseUnits("50000", 6),
            volatility: 0.02, // 2% daily volatility
            trendStrength: 0,
            volume24h: ethers.parseUnits("1000000", 6),
            marketCap: ethers.parseUnits("1000000000", 6),
            liquidityDepth: ethers.parseUnits("100000", 6)
        };

        this.assets.set(assetId, { ...defaultConfig, ...config });
        this.orderBook.set(assetId, { bids: [], asks: [], midPrice: config.basePrice || defaultConfig.basePrice });
        
        return assetId;
    }

    /**
     * Add market maker to provide liquidity
     */
    addMarketMaker(makerId, config = {}) {
        const defaultConfig = {
            assets: [],
            spreadPercent: 0.001, // 0.1% spread
            liquidityAmount: ethers.parseUnits("10000", 6),
            responsiveness: 0.8, // How quickly MM responds to price changes
            riskTolerance: 0.05 // Maximum position size as % of liquidity
        };

        this.marketMakers.set(makerId, { ...defaultConfig, ...config });
        return makerId;
    }

    /**
     * Simulate order book for an asset
     */
    updateOrderBook(assetId, midPrice) {
        const asset = this.assets.get(assetId);
        if (!asset) return;

        const book = this.orderBook.get(assetId);
        const spread = midPrice * BigInt(Math.floor(asset.volatility * 1e6)) / 1000000n;
        
        // Clear existing orders
        book.bids = [];
        book.asks = [];
        book.midPrice = midPrice;

        // Generate bid/ask levels
        const levels = 10;
        for (let i = 0; i < levels; i++) {
            const levelSpread = spread * BigInt(i + 1) / BigInt(levels);
            const liquidityDecay = Math.exp(-i * 0.2); // Less liquidity at further levels
            
            const bidSize = asset.liquidityDepth * BigInt(Math.floor(liquidityDecay * 1e6)) / 1000000n / BigInt(levels);
            const askSize = asset.liquidityDepth * BigInt(Math.floor(liquidityDecay * 1e6)) / 1000000n / BigInt(levels);

            book.bids.push({
                price: midPrice - levelSpread,
                size: bidSize,
                level: i
            });

            book.asks.push({
                price: midPrice + levelSpread,
                size: askSize,
                level: i
            });
        }
    }

    /**
     * Simulate market impact of a trade
     */
    simulateMarketImpact(assetId, size, isBuy) {
        const asset = this.assets.get(assetId);
        const book = this.orderBook.get(assetId);
        
        if (!asset || !book) return { executedSize: 0n, averagePrice: 0n, slippage: 0 };

        const orders = isBuy ? book.asks : book.bids;
        let remainingSize = size;
        let totalValue = 0n;
        let executedSize = 0n;

        for (const order of orders) {
            if (remainingSize <= 0n) break;

            const tradeSize = remainingSize < order.size ? remainingSize : order.size;
            totalValue += tradeSize * order.price / ethers.parseUnits("1", 6);
            executedSize += tradeSize;
            remainingSize -= tradeSize;
        }

        const averagePrice = executedSize > 0n ? totalValue / executedSize * ethers.parseUnits("1", 6) : 0n;
        const slippage = executedSize > 0n ? 
            Number((averagePrice - book.midPrice) * 10000n / book.midPrice) / 100 : 0;

        // Update mid price based on market impact
        const impactFactor = Number(executedSize) / Number(asset.liquidityDepth);
        const priceImpact = impactFactor * asset.volatility * (isBuy ? 1 : -1);
        const newMidPrice = book.midPrice * BigInt(Math.floor((1 + priceImpact) * 1e6)) / 1000000n;
        
        this.updateOrderBook(assetId, newMidPrice);

        return {
            executedSize,
            averagePrice,
            slippage,
            priceImpact: priceImpact * 100,
            newMidPrice
        };
    }

    /**
     * Simulate TWAP execution with market conditions
     */
    simulateTWAPExecution(assetId, totalSize, sliceSize, interval, marketCondition = 'normal') {
        const results = [];
        const slices = Number(totalSize / sliceSize);
        let remainingSize = totalSize;
        
        for (let i = 0; i < slices; i++) {
            // Apply market condition effects
            this.applyMarketCondition(assetId, marketCondition, i);
            
            const currentSliceSize = remainingSize < sliceSize ? remainingSize : sliceSize;
            const impact = this.simulateMarketImpact(assetId, currentSliceSize, true);
            
            results.push({
                slice: i + 1,
                timestamp: this.currentTime + i * interval,
                sliceSize: currentSliceSize,
                executedSize: impact.executedSize,
                price: impact.averagePrice,
                slippage: impact.slippage,
                priceImpact: impact.priceImpact,
                marketCondition
            });

            remainingSize -= impact.executedSize;
            if (remainingSize <= 0n) break;
        }

        return this.analyzeTWAPResults(results);
    }

    /**
     * Apply different market conditions
     */
    applyMarketCondition(assetId, condition, step) {
        const asset = this.assets.get(assetId);
        const book = this.orderBook.get(assetId);
        
        if (!asset || !book) return;

        let priceModifier = 1;
        let volatilityMultiplier = 1;

        switch (condition) {
            case 'trending_up':
                priceModifier = 1 + (step * 0.001); // 0.1% increase per step
                break;
                
            case 'trending_down':
                priceModifier = 1 - (step * 0.001); // 0.1% decrease per step
                break;
                
            case 'high_volatility':
                volatilityMultiplier = 3;
                priceModifier = 1 + (Math.random() - 0.5) * 0.05; // ±2.5% random
                break;
                
            case 'low_liquidity':
                asset.liquidityDepth = asset.liquidityDepth / 3n;
                break;
                
            case 'flash_crash':
                if (step === 3) priceModifier = 0.9; // 10% drop at step 3
                else if (step > 3 && step < 7) priceModifier = 1.02; // Recovery
                break;
                
            case 'whale_activity':
                // Large trades every few steps
                if (step % 3 === 0) {
                    const whaleSize = asset.liquidityDepth / 10n;
                    this.simulateMarketImpact(assetId, whaleSize, Math.random() > 0.5);
                }
                break;
        }

        // Apply volatility
        const randomVolatility = (Math.random() - 0.5) * asset.volatility * volatilityMultiplier;
        priceModifier *= (1 + randomVolatility);

        const newPrice = book.midPrice * BigInt(Math.floor(priceModifier * 1e6)) / 1000000n;
        this.updateOrderBook(assetId, newPrice);
    }

    /**
     * Analyze TWAP execution results
     */
    analyzeTWAPResults(results) {
        if (results.length === 0) return {};

        const totalExecuted = results.reduce((sum, r) => sum + Number(r.executedSize), 0);
        const weightedPriceSum = results.reduce((sum, r) => 
            sum + (Number(r.price) * Number(r.executedSize)), 0);
        const twapPrice = totalExecuted > 0 ? weightedPriceSum / totalExecuted : 0;

        const slippages = results.map(r => r.slippage);
        const avgSlippage = slippages.reduce((a, b) => a + b, 0) / slippages.length;
        const maxSlippage = Math.max(...slippages);

        const priceImpacts = results.map(r => Math.abs(r.priceImpact));
        const avgPriceImpact = priceImpacts.reduce((a, b) => a + b, 0) / priceImpacts.length;
        const maxPriceImpact = Math.max(...priceImpacts);

        // Calculate TWAP efficiency metrics
        const firstPrice = results[0].price;
        const lastPrice = results[results.length - 1].price;
        const priceVolatility = Math.abs(Number(lastPrice - firstPrice)) / Number(firstPrice) * 100;

        return {
            execution: results,
            summary: {
                totalSlices: results.length,
                totalExecuted: ethers.formatUnits(totalExecuted.toString(), 6),
                twapPrice: ethers.formatUnits(Math.floor(twapPrice).toString(), 6),
                avgSlippage: avgSlippage.toFixed(4),
                maxSlippage: maxSlippage.toFixed(4),
                avgPriceImpact: avgPriceImpact.toFixed(4),
                maxPriceImpact: maxPriceImpact.toFixed(4),
                priceVolatility: priceVolatility.toFixed(4),
                executionEfficiency: this.calculateEfficiency(results)
            }
        };
    }

    /**
     * Calculate execution efficiency score
     */
    calculateEfficiency(results) {
        if (results.length === 0) return 0;

        // Factors: low slippage, consistent execution, minimal price impact
        const avgSlippage = results.reduce((sum, r) => sum + Math.abs(r.slippage), 0) / results.length;
        const slippageConsistency = 1 - (Math.max(...results.map(r => Math.abs(r.slippage))) - Math.min(...results.map(r => Math.abs(r.slippage)))) / 10;
        const avgPriceImpact = results.reduce((sum, r) => sum + Math.abs(r.priceImpact), 0) / results.length;

        const slippageScore = Math.max(0, 1 - avgSlippage / 5); // Perfect score if <5% slippage
        const consistencyScore = Math.max(0, slippageConsistency);
        const impactScore = Math.max(0, 1 - avgPriceImpact / 2); // Perfect score if <2% impact

        return ((slippageScore + consistencyScore + impactScore) / 3 * 100).toFixed(2);
    }

    /**
     * Generate stress test scenarios
     */
    generateStressTest(assetId, orderSize) {
        const scenarios = [
            {
                name: 'Normal Market',
                condition: 'normal',
                description: 'Standard market conditions with normal volatility'
            },
            {
                name: 'Bull Run',
                condition: 'trending_up',
                description: 'Strong upward price trend during execution'
            },
            {
                name: 'Bear Market',
                condition: 'trending_down',
                description: 'Downward price pressure during execution'
            },
            {
                name: 'High Volatility',
                condition: 'high_volatility',
                description: 'Extreme price swings and volatility'
            },
            {
                name: 'Low Liquidity',
                condition: 'low_liquidity',
                description: 'Thin order books with limited liquidity'
            },
            {
                name: 'Flash Crash',
                condition: 'flash_crash',
                description: 'Sudden market crash followed by recovery'
            },
            {
                name: 'Whale Activity',
                condition: 'whale_activity',
                description: 'Large trades from institutional players'
            }
        ];

        const results = [];
        for (const scenario of scenarios) {
            this.resetMarket(assetId); // Reset market state
            const result = this.simulateTWAPExecution(
                assetId,
                orderSize,
                orderSize / 10n, // 10 slices
                300, // 5-minute intervals
                scenario.condition
            );
            
            results.push({
                scenario: scenario.name,
                description: scenario.description,
                ...result
            });
        }

        return results;
    }

    /**
     * Reset market to initial state
     */
    resetMarket(assetId) {
        const asset = this.assets.get(assetId);
        if (asset) {
            this.updateOrderBook(assetId, asset.basePrice);
            asset.liquidityDepth = ethers.parseUnits("100000", 6); // Reset liquidity
        }
    }

    /**
     * Simulate order book manipulation attacks
     */
    simulateManipulation(assetId, attackType) {
        const attacks = {
            'spoofing': () => {
                // Add and quickly remove large orders
                const book = this.orderBook.get(assetId);
                const spoofSize = book.midPrice * 10n; // Large fake order
                
                book.bids.unshift({ price: book.midPrice - 1000n, size: spoofSize, level: -1 });
                setTimeout(() => {
                    book.bids = book.bids.filter(bid => bid.level >= 0);
                }, 100);
            },
            
            'layering': () => {
                // Add multiple orders at same level
                const book = this.orderBook.get(assetId);
                for (let i = 0; i < 5; i++) {
                    book.asks.push({ 
                        price: book.midPrice + 100n, 
                        size: ethers.parseUnits("1000", 6), 
                        level: -1 
                    });
                }
            },
            
            'wash_trading': () => {
                // Simulate artificial volume
                for (let i = 0; i < 10; i++) {
                    this.tradeHistory.push({
                        timestamp: this.currentTime,
                        asset: assetId,
                        size: ethers.parseUnits("100", 6),
                        price: this.orderBook.get(assetId).midPrice,
                        type: 'wash'
                    });
                }
            }
        };

        if (attacks[attackType]) {
            attacks[attackType]();
            return true;
        }
        return false;
    }

    /**
     * Get market statistics
     */
    getMarketStats(assetId) {
        const asset = this.assets.get(assetId);
        const book = this.orderBook.get(assetId);
        
        if (!asset || !book) return null;

        const totalBidLiquidity = book.bids.reduce((sum, bid) => sum + bid.size, 0n);
        const totalAskLiquidity = book.asks.reduce((sum, ask) => sum + ask.size, 0n);
        const spread = book.asks[0] ? book.asks[0].price - book.bids[0].price : 0n;
        const spreadPercent = Number(spread * 10000n / book.midPrice) / 100;

        return {
            asset: asset.symbol,
            midPrice: ethers.formatUnits(book.midPrice.toString(), 6),
            spread: ethers.formatUnits(spread.toString(), 6),
            spreadPercent: spreadPercent.toFixed(4),
            bidLiquidity: ethers.formatUnits(totalBidLiquidity.toString(), 6),
            askLiquidity: ethers.formatUnits(totalAskLiquidity.toString(), 6),
            totalLiquidity: ethers.formatUnits((totalBidLiquidity + totalAskLiquidity).toString(), 6),
            volatility: (asset.volatility * 100).toFixed(2) + '%',
            volume24h: ethers.formatUnits(asset.volume24h.toString(), 6),
            marketCap: ethers.formatUnits(asset.marketCap.toString(), 6)
        };
    }

    /**
     * Export simulation data for analysis
     */
    exportData() {
        return {
            assets: Object.fromEntries(this.assets),
            orderBooks: Object.fromEntries(this.orderBook),
            tradeHistory: this.tradeHistory,
            timestamp: this.currentTime
        };
    }
}

module.exports = { MarketSimulator };