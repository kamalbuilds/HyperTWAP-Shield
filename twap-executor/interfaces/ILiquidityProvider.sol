// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ILiquidityProvider
 * @dev Interface for liquidity provider offering market depth and liquidity data
 */
interface ILiquidityProvider {
    struct LiquidityDepth {
        uint256 bidLiquidity;    // Available liquidity on buy side
        uint256 askLiquidity;    // Available liquidity on sell side
        uint256 bidPrice;        // Best bid price
        uint256 askPrice;        // Best ask price
        uint256 lastUpdate;      // Timestamp of last update
    }
    
    /**
     * @dev Get current liquidity metrics for an asset
     * @param asset The asset identifier
     * @return totalLiquidity Combined bid/ask liquidity
     * @return spread Current bid-ask spread
     */
    function getLiquidityMetrics(uint32 asset) external view returns (uint256 totalLiquidity, uint256 spread);
    
    /**
     * @dev Get detailed liquidity depth
     * @param asset The asset identifier
     * @return depth Detailed liquidity depth information
     */
    function getLiquidityDepth(uint32 asset) external view returns (LiquidityDepth memory depth);
    
    /**
     * @dev Get 24-hour trading volume
     * @param asset The asset identifier
     * @return volume24h Trading volume in the last 24 hours
     */
    function getVolume24h(uint32 asset) external view returns (uint256 volume24h);
    
    /**
     * @dev Get liquidity at specific price levels
     * @param asset The asset identifier
     * @param priceLevel The price level to check liquidity at
     * @param isBuy Whether checking buy-side (true) or sell-side (false) liquidity
     * @return liquidity Available liquidity at the price level
     */
    function getLiquidityAtPrice(uint32 asset, uint256 priceLevel, bool isBuy) external view returns (uint256 liquidity);
    
    /**
     * @dev Estimate market impact of a trade
     * @param asset The asset identifier
     * @param tradeSize Size of the trade
     * @param isBuy Whether it's a buy (true) or sell (false) order
     * @return impactBps Expected market impact in basis points
     * @return newPrice Expected price after impact
     */
    function estimateMarketImpact(uint32 asset, uint256 tradeSize, bool isBuy) external view returns (uint256 impactBps, uint256 newPrice);
}