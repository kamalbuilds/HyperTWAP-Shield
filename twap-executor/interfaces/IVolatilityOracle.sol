// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IVolatilityOracle
 * @dev Interface for volatility oracle providing market volatility data
 */
interface IVolatilityOracle {
    /**
     * @dev Get current volatility for an asset
     * @param asset The asset identifier
     * @return volatility Current volatility (scaled by 1e18, representing annualized volatility)
     */
    function getVolatility(uint32 asset) external view returns (uint256 volatility);
    
    /**
     * @dev Get historical volatility over a specific period
     * @param asset The asset identifier
     * @param periodSeconds The period in seconds to calculate volatility over
     * @return volatility Historical volatility for the period
     */
    function getHistoricalVolatility(uint32 asset, uint256 periodSeconds) external view returns (uint256 volatility);
    
    /**
     * @dev Get volatility prediction for future period
     * @param asset The asset identifier
     * @param futurePeriodSeconds The future period to predict volatility for
     * @return predictedVolatility Predicted volatility
     */
    function getPredictedVolatility(uint32 asset, uint256 futurePeriodSeconds) external view returns (uint256 predictedVolatility);
    
    /**
     * @dev Check if volatility data is fresh
     * @param asset The asset identifier
     * @return isFresh True if data is within acceptable freshness threshold
     * @return lastUpdate Timestamp of last update
     */
    function isDataFresh(uint32 asset) external view returns (bool isFresh, uint256 lastUpdate);
}