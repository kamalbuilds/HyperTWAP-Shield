// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IVolatilityOracle.sol";
import "../interfaces/ILiquidityProvider.sol";

/**
 * @title AdaptiveExecutor
 * @dev Handles dynamic slice sizing and adaptive execution logic for TWAP orders
 */
contract AdaptiveExecutor {
    
    struct MarketConditions {
        uint256 volatility;      // Scaled by 1e18
        uint256 liquidity;       // Available liquidity depth
        uint256 spread;          // Current bid-ask spread
        uint256 volume24h;       // 24h trading volume
        uint256 lastUpdate;      // Timestamp of last update
    }
    
    struct AdaptiveConfig {
        uint256 baseSliceRatio;      // Base slice as % of total order (scaled by 1e4)
        uint256 volatilityThreshold; // High volatility threshold (scaled by 1e18)
        uint256 liquidityThreshold;  // Low liquidity threshold
        uint256 maxSliceIncrease;    // Maximum slice size increase (%)
        uint256 minSliceDecrease;    // Minimum slice size decrease (%)
        uint256 intervalMultiplier;  // Interval adjustment multiplier
    }
    
    mapping(uint32 => MarketConditions) private marketConditions;
    mapping(bytes32 => uint256) private orderVolatilityHistory;
    
    AdaptiveConfig public config;
    IVolatilityOracle public volatilityOracle;
    ILiquidityProvider public liquidityProvider;
    
    // Events
    event SliceSizeAdjusted(bytes32 indexed orderId, uint64 oldSize, uint64 newSize, string reason);
    event IntervalAdjusted(bytes32 indexed orderId, uint256 oldInterval, uint256 newInterval, string reason);
    event MarketConditionsUpdated(uint32 indexed asset, MarketConditions conditions);
    
    constructor(
        address _volatilityOracle,
        address _liquidityProvider
    ) {
        volatilityOracle = IVolatilityOracle(_volatilityOracle);
        liquidityProvider = ILiquidityProvider(_liquidityProvider);
        
        // Default configuration
        config = AdaptiveConfig({
            baseSliceRatio: 500,        // 5%
            volatilityThreshold: 5e17,  // 50% annualized
            liquidityThreshold: 10000e18, // 10,000 units
            maxSliceIncrease: 200,      // 200% of base
            minSliceDecrease: 25,       // 25% of base
            intervalMultiplier: 150     // 1.5x multiplier
        });
    }
    
    /**
     * @dev Calculate adaptive slice size based on market conditions
     */
    function calculateAdaptiveSliceSize(
        bytes32 orderId,
        uint32 asset,
        uint64 totalSize,
        uint64 baseSliceSize
    ) external returns (uint64 adaptiveSliceSize) {
        MarketConditions memory conditions = _updateMarketConditions(asset);
        
        uint256 adaptionFactor = 1e4; // Base factor (100%)
        
        // Adjust for volatility
        if (conditions.volatility > config.volatilityThreshold) {
            // High volatility: reduce slice size for more granular execution
            adaptionFactor = adaptionFactor * 50 / 100; // Reduce by 50%
            emit SliceSizeAdjusted(orderId, baseSliceSize, 0, "High volatility detected");
        } else if (conditions.volatility < config.volatilityThreshold / 2) {
            // Low volatility: increase slice size for efficiency
            adaptionFactor = adaptionFactor * 150 / 100; // Increase by 50%
            emit SliceSizeAdjusted(orderId, baseSliceSize, 0, "Low volatility - increasing efficiency");
        }
        
        // Adjust for liquidity
        if (conditions.liquidity < config.liquidityThreshold) {
            // Low liquidity: reduce slice size to minimize impact
            adaptionFactor = adaptionFactor * 40 / 100;
            emit SliceSizeAdjusted(orderId, baseSliceSize, 0, "Low liquidity detected");
        }
        
        // Adjust for spread
        uint256 normalSpread = conditions.volume24h > 0 ? 
            (conditions.spread * 1e18) / conditions.volume24h : 1e18;
        
        if (normalSpread > 5e15) { // 0.5% normalized spread
            adaptionFactor = adaptionFactor * 60 / 100;
            emit SliceSizeAdjusted(orderId, baseSliceSize, 0, "High spread detected");
        }
        
        // Apply bounds
        if (adaptionFactor > config.maxSliceIncrease * 100) {
            adaptionFactor = config.maxSliceIncrease * 100;
        } else if (adaptionFactor < config.minSliceDecrease * 100) {
            adaptionFactor = config.minSliceDecrease * 100;
        }
        
        adaptiveSliceSize = uint64((uint256(baseSliceSize) * adaptionFactor) / 1e4);
        
        // Ensure slice doesn't exceed remaining order size
        if (adaptiveSliceSize > totalSize) {
            adaptiveSliceSize = totalSize;
        }
        
        // Minimum slice size of 1 unit
        if (adaptiveSliceSize == 0) {
            adaptiveSliceSize = 1;
        }
        
        emit SliceSizeAdjusted(orderId, baseSliceSize, adaptiveSliceSize, "Adaptive calculation complete");
    }
    
    /**
     * @dev Calculate adaptive execution interval based on market conditions
     */
    function calculateAdaptiveInterval(
        bytes32 orderId,
        uint32 asset,
        uint256 baseInterval
    ) external returns (uint256 adaptiveInterval) {
        MarketConditions memory conditions = _updateMarketConditions(asset);
        
        uint256 intervalMultiplier = 100; // Base 100%
        
        // High volatility: execute more frequently
        if (conditions.volatility > config.volatilityThreshold) {
            intervalMultiplier = 60; // 60% of base interval (more frequent)
            emit IntervalAdjusted(orderId, baseInterval, 0, "High volatility - increasing frequency");
        }
        
        // Low liquidity: execute less frequently to reduce impact
        if (conditions.liquidity < config.liquidityThreshold) {
            intervalMultiplier = intervalMultiplier * config.intervalMultiplier / 100;
            emit IntervalAdjusted(orderId, baseInterval, 0, "Low liquidity - reducing frequency");
        }
        
        // Market hours adjustment (assuming 24/7 for crypto)
        uint256 hourOfDay = (block.timestamp / 3600) % 24;
        if (hourOfDay >= 2 && hourOfDay <= 8) { // Low activity hours (UTC)
            intervalMultiplier = intervalMultiplier * 120 / 100; // 20% longer intervals
        }
        
        adaptiveInterval = (baseInterval * intervalMultiplier) / 100;
        
        // Ensure minimum interval of 30 seconds
        if (adaptiveInterval < 30) {
            adaptiveInterval = 30;
        }
        
        emit IntervalAdjusted(orderId, baseInterval, adaptiveInterval, "Adaptive interval calculated");
    }
    
    /**
     * @dev Calculate price impact based on order size and market depth
     */
    function calculatePriceImpact(
        uint32 asset,
        uint64 orderSize,
        bool isBuy
    ) external view returns (uint256 impactBps) {
        MarketConditions memory conditions = marketConditions[asset];
        
        if (conditions.liquidity == 0) {
            return 10000; // 100% impact if no liquidity data
        }
        
        // Simple impact model: impact = (orderSize / availableLiquidity) * spreadMultiplier
        uint256 sizeRatio = (uint256(orderSize) * 1e18) / conditions.liquidity;
        uint256 spreadMultiplier = conditions.spread > 0 ? conditions.spread : 1e15; // Min 0.1%
        
        impactBps = (sizeRatio * spreadMultiplier) / 1e14; // Convert to basis points
        
        // Cap at 1000 bps (10%)
        if (impactBps > 1000) {
            impactBps = 1000;
        }
    }
    
    /**
     * @dev Get optimal execution timing based on historical patterns
     */
    function getOptimalExecutionTiming(
        uint32 asset
    ) external view returns (uint256 suggestedDelay) {
        MarketConditions memory conditions = marketConditions[asset];
        
        // Base delay on volatility
        if (conditions.volatility > config.volatilityThreshold) {
            // High volatility: shorter delays but add randomization
            suggestedDelay = 30 + (uint256(keccak256(abi.encodePacked(block.timestamp, asset))) % 60);
        } else {
            // Normal volatility: standard delays
            suggestedDelay = 60 + (uint256(keccak256(abi.encodePacked(block.timestamp, asset))) % 120);
        }
    }
    
    /**
     * @dev Update market conditions for an asset
     */
    function _updateMarketConditions(uint32 asset) internal returns (MarketConditions memory) {
        MarketConditions storage conditions = marketConditions[asset];
        
        // Update if data is older than 5 minutes
        if (block.timestamp - conditions.lastUpdate > 300) {
            conditions.volatility = volatilityOracle.getVolatility(asset);
            (conditions.liquidity, conditions.spread) = liquidityProvider.getLiquidityMetrics(asset);
            conditions.volume24h = liquidityProvider.getVolume24h(asset);
            conditions.lastUpdate = block.timestamp;
            
            emit MarketConditionsUpdated(asset, conditions);
        }
        
        return conditions;
    }
    
    /**
     * @dev Update configuration parameters (admin only)
     */
    function updateConfig(AdaptiveConfig memory newConfig) external {
        // Add access control in production
        config = newConfig;
    }
    
    /**
     * @dev Get current market conditions for an asset
     */
    function getMarketConditions(uint32 asset) external view returns (MarketConditions memory) {
        return marketConditions[asset];
    }
    
    /**
     * @dev Emergency function to force market data update
     */
    function forceMarketUpdate(uint32 asset) external {
        _updateMarketConditions(asset);
    }
}