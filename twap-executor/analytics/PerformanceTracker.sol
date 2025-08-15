// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title PerformanceTracker
 * @dev Real-time performance metrics and analytics for TWAP execution
 */
contract PerformanceTracker {
    
    struct ExecutionMetrics {
        uint64 executedAmount;
        uint64 averagePrice;
        uint64 marketPrice;
        uint256 slippage;        // In basis points
        uint256 gasUsed;
        uint256 executionTime;
        uint256 timestamp;
    }
    
    struct OrderPerformance {
        bytes32 orderId;
        uint32 asset;
        uint64 totalSize;
        uint64 totalExecuted;
        uint256 totalGasUsed;
        uint256 totalSlippage;
        uint256 startTime;
        uint256 endTime;
        uint256 averageExecutionPrice;
        uint256 benchmarkPrice;     // TWAP benchmark
        uint256 performanceScore;   // 0-10000 (basis points)
        bool completed;
    }
    
    struct AssetMetrics {
        uint256 totalVolume;
        uint256 totalOrders;
        uint256 averageSlippage;
        uint256 averageGasUsed;
        uint256 successRate;        // In basis points
        uint256 lastUpdate;
    }
    
    struct GlobalMetrics {
        uint256 totalOrdersExecuted;
        uint256 totalVolumeExecuted;
        uint256 averagePerformanceScore;
        uint256 totalGasSaved;
        uint256 uptime;
        uint256 lastMetricsUpdate;
    }
    
    // State variables
    mapping(bytes32 => OrderPerformance) private orderPerformance;
    mapping(bytes32 => ExecutionMetrics[]) private executionHistory;
    mapping(uint32 => AssetMetrics) private assetMetrics;
    mapping(address => bytes32[]) private userOrderHistory;
    
    GlobalMetrics public globalMetrics;
    
    // Performance thresholds
    uint256 public constant EXCELLENT_PERFORMANCE = 9500;  // 95%
    uint256 public constant GOOD_PERFORMANCE = 8500;       // 85%
    uint256 public constant POOR_PERFORMANCE = 7000;       // 70%
    
    // Events
    event ExecutionRecorded(bytes32 indexed orderId, ExecutionMetrics metrics);
    event OrderCompleted(bytes32 indexed orderId, OrderPerformance performance);
    event PerformanceAlert(bytes32 indexed orderId, uint256 performanceScore, string alertType);
    event MetricsUpdated(uint32 indexed asset, AssetMetrics metrics);
    
    /**
     * @dev Record execution metrics for a TWAP slice
     */
    function recordExecution(
        bytes32 orderId,
        uint32 asset,
        uint64 executedAmount,
        uint64 executionPrice,
        uint64 marketPrice,
        uint256 gasUsed,
        uint256 executionTime
    ) external {
        uint256 slippage = _calculateSlippage(executionPrice, marketPrice);
        
        ExecutionMetrics memory metrics = ExecutionMetrics({
            executedAmount: executedAmount,
            averagePrice: executionPrice,
            marketPrice: marketPrice,
            slippage: slippage,
            gasUsed: gasUsed,
            executionTime: executionTime,
            timestamp: block.timestamp
        });
        
        executionHistory[orderId].push(metrics);
        
        // Update order performance
        _updateOrderPerformance(orderId, asset, metrics);
        
        // Update asset metrics
        _updateAssetMetrics(asset, metrics);
        
        // Update global metrics
        _updateGlobalMetrics(metrics);
        
        emit ExecutionRecorded(orderId, metrics);
        
        // Check for performance alerts
        _checkPerformanceAlerts(orderId, metrics);
    }
    
    /**
     * @dev Complete order tracking and calculate final performance
     */
    function completeOrderTracking(
        bytes32 orderId,
        uint256 benchmarkPrice
    ) external {
        OrderPerformance storage performance = orderPerformance[orderId];
        require(!performance.completed, "Order already completed");
        
        performance.endTime = block.timestamp;
        performance.benchmarkPrice = benchmarkPrice;
        performance.completed = true;
        
        // Calculate final performance score
        performance.performanceScore = _calculatePerformanceScore(orderId);
        
        // Update asset success rate
        AssetMetrics storage assetMetric = assetMetrics[performance.asset];
        assetMetric.successRate = ((assetMetric.successRate * (assetMetric.totalOrders - 1)) + 
                                  performance.performanceScore) / assetMetric.totalOrders;
        
        emit OrderCompleted(orderId, performance);
    }
    
    /**
     * @dev Initialize order tracking
     */
    function initializeOrderTracking(
        bytes32 orderId,
        address owner,
        uint32 asset,
        uint64 totalSize
    ) external {
        orderPerformance[orderId] = OrderPerformance({
            orderId: orderId,
            asset: asset,
            totalSize: totalSize,
            totalExecuted: 0,
            totalGasUsed: 0,
            totalSlippage: 0,
            startTime: block.timestamp,
            endTime: 0,
            averageExecutionPrice: 0,
            benchmarkPrice: 0,
            performanceScore: 0,
            completed: false
        });
        
        userOrderHistory[owner].push(orderId);
    }
    
    /**
     * @dev Get comprehensive performance report for an order
     */
    function getOrderPerformanceReport(bytes32 orderId) external view returns (
        OrderPerformance memory performance,
        ExecutionMetrics[] memory executions,
        uint256 totalSlices,
        uint256 averageSlippage,
        uint256 averageGasPerSlice
    ) {
        performance = orderPerformance[orderId];
        executions = executionHistory[orderId];
        totalSlices = executions.length;
        
        if (totalSlices > 0) {
            uint256 totalSlippage = 0;
            uint256 totalGas = 0;
            
            for (uint256 i = 0; i < totalSlices; i++) {
                totalSlippage += executions[i].slippage;
                totalGas += executions[i].gasUsed;
            }
            
            averageSlippage = totalSlippage / totalSlices;
            averageGasPerSlice = totalGas / totalSlices;
        }
    }
    
    /**
     * @dev Get asset performance metrics
     */
    function getAssetMetrics(uint32 asset) external view returns (AssetMetrics memory) {
        return assetMetrics[asset];
    }
    
    /**
     * @dev Get user's order history and performance
     */
    function getUserPerformanceHistory(address user) external view returns (
        bytes32[] memory orderIds,
        uint256 totalOrders,
        uint256 averagePerformance,
        uint256 totalVolume
    ) {
        orderIds = userOrderHistory[user];
        totalOrders = orderIds.length;
        
        if (totalOrders > 0) {
            uint256 totalPerformance = 0;
            
            for (uint256 i = 0; i < totalOrders; i++) {
                OrderPerformance memory performance = orderPerformance[orderIds[i]];
                totalPerformance += performance.performanceScore;
                totalVolume += performance.totalExecuted;
            }
            
            averagePerformance = totalPerformance / totalOrders;
        }
    }
    
    /**
     * @dev Get real-time analytics dashboard data
     */
    function getAnalyticsDashboard() external view returns (
        GlobalMetrics memory global,
        uint256 activeOrders,
        uint256 last24hVolume,
        uint256 last24hOrders,
        uint256 averageExecutionTime
    ) {
        global = globalMetrics;
        
        // Calculate 24h metrics (simplified - in production use more sophisticated tracking)
        uint256 cutoffTime = block.timestamp - 24 hours;
        
        // These would be efficiently tracked in production with sliding windows
        last24hVolume = 0;
        last24hOrders = 0;
        activeOrders = 0;
        averageExecutionTime = 300; // Default 5 minutes
    }
    
    /**
     * @dev Get performance comparison between different time periods
     */
    function getPerformanceComparison(
        uint256 period1Start,
        uint256 period1End,
        uint256 period2Start,
        uint256 period2End
    ) external view returns (
        uint256 period1AvgPerformance,
        uint256 period2AvgPerformance,
        uint256 period1Volume,
        uint256 period2Volume,
        int256 performanceChange
    ) {
        // Simplified implementation - would use more efficient data structures in production
        // This would typically involve iterating through time-indexed data
        
        period1AvgPerformance = 8500; // Placeholder
        period2AvgPerformance = 8800; // Placeholder
        period1Volume = 1000000;      // Placeholder
        period2Volume = 1200000;      // Placeholder
        
        performanceChange = int256(period2AvgPerformance) - int256(period1AvgPerformance);
    }
    
    /**
     * @dev Calculate slippage in basis points
     */
    function _calculateSlippage(uint64 executionPrice, uint64 marketPrice) internal pure returns (uint256) {
        if (marketPrice == 0) return 0;
        
        uint256 difference = executionPrice > marketPrice ? 
            executionPrice - marketPrice : marketPrice - executionPrice;
        
        return (difference * 10000) / marketPrice;
    }
    
    /**
     * @dev Update order performance metrics
     */
    function _updateOrderPerformance(
        bytes32 orderId,
        uint32 asset,
        ExecutionMetrics memory metrics
    ) internal {
        OrderPerformance storage performance = orderPerformance[orderId];
        
        if (performance.orderId == bytes32(0)) {
            // Initialize if first execution
            performance.orderId = orderId;
            performance.asset = asset;
            performance.startTime = block.timestamp;
        }
        
        performance.totalExecuted += metrics.executedAmount;
        performance.totalGasUsed += metrics.gasUsed;
        performance.totalSlippage += metrics.slippage;
        
        // Update weighted average execution price
        uint256 totalWeight = performance.totalExecuted;
        if (totalWeight > 0) {
            performance.averageExecutionPrice = 
                ((performance.averageExecutionPrice * (totalWeight - metrics.executedAmount)) + 
                 (uint256(metrics.averagePrice) * metrics.executedAmount)) / totalWeight;
        }
    }
    
    /**
     * @dev Update asset-level metrics
     */
    function _updateAssetMetrics(uint32 asset, ExecutionMetrics memory metrics) internal {
        AssetMetrics storage assetMetric = assetMetrics[asset];
        
        assetMetric.totalVolume += metrics.executedAmount;
        assetMetric.totalOrders++;
        
        // Update averages
        assetMetric.averageSlippage = ((assetMetric.averageSlippage * (assetMetric.totalOrders - 1)) + 
                                      metrics.slippage) / assetMetric.totalOrders;
        
        assetMetric.averageGasUsed = ((assetMetric.averageGasUsed * (assetMetric.totalOrders - 1)) + 
                                     metrics.gasUsed) / assetMetric.totalOrders;
        
        assetMetric.lastUpdate = block.timestamp;
        
        emit MetricsUpdated(asset, assetMetric);
    }
    
    /**
     * @dev Update global metrics
     */
    function _updateGlobalMetrics(ExecutionMetrics memory metrics) internal {
        globalMetrics.totalOrdersExecuted++;
        globalMetrics.totalVolumeExecuted += metrics.executedAmount;
        globalMetrics.lastMetricsUpdate = block.timestamp;
        
        // Update uptime (simplified)
        globalMetrics.uptime = block.timestamp - globalMetrics.lastMetricsUpdate;
    }
    
    /**
     * @dev Calculate performance score for completed order
     */
    function _calculatePerformanceScore(bytes32 orderId) internal view returns (uint256) {
        OrderPerformance memory performance = orderPerformance[orderId];
        ExecutionMetrics[] memory executions = executionHistory[orderId];
        
        if (executions.length == 0) return 0;
        
        uint256 score = 10000; // Start with perfect score
        
        // Penalize for high slippage
        if (performance.totalSlippage > 100) { // > 1%
            score = (score * 8000) / 10000; // -20%
        } else if (performance.totalSlippage > 50) { // > 0.5%
            score = (score * 9000) / 10000; // -10%
        }
        
        // Penalize for high gas usage
        uint256 averageGas = performance.totalGasUsed / executions.length;
        if (averageGas > 200000) {
            score = (score * 9000) / 10000; // -10%
        }
        
        // Reward for timely execution
        uint256 executionDuration = performance.endTime - performance.startTime;
        uint256 expectedDuration = executions.length * 300; // 5 minutes per slice
        
        if (executionDuration <= expectedDuration) {
            score = (score * 11000) / 10000; // +10% bonus
        }
        
        // Penalize for deviation from benchmark
        if (performance.benchmarkPrice > 0 && performance.averageExecutionPrice > 0) {
            uint256 deviation = performance.averageExecutionPrice > performance.benchmarkPrice ?
                performance.averageExecutionPrice - performance.benchmarkPrice :
                performance.benchmarkPrice - performance.averageExecutionPrice;
            
            uint256 deviationBps = (deviation * 10000) / performance.benchmarkPrice;
            
            if (deviationBps > 200) { // > 2% deviation
                score = (score * 7000) / 10000; // -30%
            } else if (deviationBps > 100) { // > 1% deviation
                score = (score * 8500) / 10000; // -15%
            }
        }
        
        return score > 10000 ? 10000 : score;
    }
    
    /**
     * @dev Check for performance alerts
     */
    function _checkPerformanceAlerts(bytes32 orderId, ExecutionMetrics memory metrics) internal {
        // High slippage alert
        if (metrics.slippage > 200) { // > 2%
            emit PerformanceAlert(orderId, metrics.slippage, "HIGH_SLIPPAGE");
        }
        
        // High gas usage alert
        if (metrics.gasUsed > 300000) {
            emit PerformanceAlert(orderId, metrics.gasUsed, "HIGH_GAS");
        }
        
        // Slow execution alert
        if (metrics.executionTime > 600) { // > 10 minutes
            emit PerformanceAlert(orderId, metrics.executionTime, "SLOW_EXECUTION");
        }
    }
}