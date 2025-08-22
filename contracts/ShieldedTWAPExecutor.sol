// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ICoreWriter.sol";
import "./interfaces/IL1Read.sol";
import "../twap-executor/execution/AdaptiveExecutor.sol";
import "../twap-executor/shielding/PrivacyManager.sol";
import "../twap-executor/analytics/PerformanceTracker.sol";

contract ShieldedTWAPExecutor {
    struct TWAPOrder {
        uint32 asset;
        uint64 totalSize;
        uint64 executedSize;
        uint64 baseSliceSize;
        uint64 minPrice;
        uint64 maxPrice;
        uint256 baseInterval;
        uint256 nextExecutionTime;
        bool isBuy;
        bool active;
        address owner;
        bytes32 secretHash;
        bytes32 commitmentHash;  // For commit-reveal scheme
        uint256 randomSeed;      // For MEV protection
        bool useAdaptiveExecution;
    }
    
    struct BatchOrder {
        bytes32[] orderIds;
        bytes32 merkleRoot;
        uint256 executionTime;
        bool executed;
    }
    
    struct ExecutionResult {
        bool success;
        uint64 executedAmount;
        uint64 averagePrice;
        uint256 gasUsed;
        uint256 slippage;
        uint256 priceImpact;
    }
    
    ICoreWriter constant CORE_WRITER = ICoreWriter(0x3333333333333333333333333333333333333333);
    IPerpsOracles constant PERPS_ORACLE = IPerpsOracles(0x0000000000000000000000000000000000000807);
    
    // Enhanced state variables
    mapping(bytes32 => TWAPOrder) private shieldedOrders;
    mapping(address => bytes32[]) private userOrders;
    mapping(bytes32 => BatchOrder) private batchOrders;
    mapping(uint32 => uint256) private assetNonces; // Per-asset nonces for randomization
    
    // Component contracts
    AdaptiveExecutor public adaptiveExecutor;
    PrivacyManager public privacyManager;
    PerformanceTracker public performanceTracker;
    
    uint256 private nonce;
    uint256 private constant MIN_INTERVAL = 30;        // Reduced for more flexibility
    uint256 private constant MAX_SLICES = 200;         // Increased for larger orders
    uint256 private constant MAX_BATCH_SIZE = 50;      // Maximum orders in one batch
    uint256 private constant MEV_PROTECTION_WINDOW = 300; // 5 minutes
    
    event TWAPOrderCreated(
        bytes32 indexed orderId,
        address indexed owner,
        uint32 asset,
        uint64 totalSize,
        bool adaptive
    );
    
    event TWAPSliceExecuted(
        bytes32 indexed orderId,
        uint64 executedSize,
        uint64 price,
        uint256 slippage,
        uint256 gasUsed,
        uint256 timestamp
    );
    
    event TWAPOrderCompleted(
        bytes32 indexed orderId,
        uint64 totalExecuted,
        uint64 averagePrice,
        uint256 performanceScore
    );
    
    event BatchOrderCreated(
        bytes32 indexed batchId,
        bytes32 merkleRoot,
        uint256 orderCount
    );
    
    event BatchOrderExecuted(
        bytes32 indexed batchId,
        uint256 executedCount,
        uint256 totalGasUsed
    );
    
    event MEVProtectionTriggered(
        bytes32 indexed orderId,
        uint256 randomDelay,
        uint256 newExecutionTime
    );
    
    modifier onlyOrderOwner(bytes32 orderId) {
        require(shieldedOrders[orderId].owner == msg.sender, "Not order owner");
        _;
    }
    
    constructor(
        address _adaptiveExecutor,
        address _privacyManager, 
        address _performanceTracker
    ) {
        adaptiveExecutor = AdaptiveExecutor(_adaptiveExecutor);
        privacyManager = PrivacyManager(_privacyManager);
        performanceTracker = PerformanceTracker(_performanceTracker);
    }
    
    function createShieldedTWAP(
        uint32 asset,
        uint64 totalSize,
        uint64 baseSliceSize,
        uint256 baseInterval,
        uint64 minPrice,
        uint64 maxPrice,
        bool isBuy,
        bytes32 secret,
        bool useAdaptiveExecution,
        bytes32 commitmentHash
    ) public returns (bytes32) {
        require(totalSize > 0 && baseSliceSize > 0, "Invalid sizes");
        require(totalSize >= baseSliceSize, "Slice too large");
        require(baseInterval >= MIN_INTERVAL, "Interval too short");
        require(totalSize / baseSliceSize <= MAX_SLICES, "Too many slices");
        
        // Generate random seed for MEV protection
        uint256 randomSeed = uint256(keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            msg.sender,
            assetNonces[asset]++,
            secret
        )));
        
        bytes32 orderId = keccak256(
            abi.encodePacked(msg.sender, asset, totalSize, nonce++, secret, randomSeed)
        );
        
        shieldedOrders[orderId] = TWAPOrder({
            asset: asset,
            totalSize: totalSize,
            executedSize: 0,
            baseSliceSize: baseSliceSize,
            minPrice: minPrice,
            maxPrice: maxPrice,
            baseInterval: baseInterval,
            nextExecutionTime: block.timestamp + _generateMEVDelay(orderId, randomSeed),
            isBuy: isBuy,
            active: true,
            owner: msg.sender,
            secretHash: keccak256(abi.encodePacked(secret)),
            commitmentHash: commitmentHash,
            randomSeed: randomSeed,
            useAdaptiveExecution: useAdaptiveExecution
        });
        
        userOrders[msg.sender].push(orderId);
        
        // Initialize performance tracking
        performanceTracker.initializeOrderTracking(orderId, msg.sender, asset, totalSize);
        
        emit TWAPOrderCreated(orderId, msg.sender, asset, totalSize, useAdaptiveExecution);
        
        return orderId;
    }
    
    function executeTWAPSlice(
        bytes32 orderId,
        bytes32 secret
    ) external returns (ExecutionResult memory) {
        TWAPOrder storage order = shieldedOrders[orderId];
        
        require(order.active, "Order not active");
        require(
            keccak256(abi.encodePacked(secret)) == order.secretHash,
            "Invalid secret"
        );
        require(
            block.timestamp >= order.nextExecutionTime,
            "Too early"
        );
        
        // MEV protection: additional random delay check
        if (block.timestamp < order.nextExecutionTime + privacyManager.generateRandomDelay(orderId, 60)) {
            uint256 newDelay = privacyManager.generateRandomDelay(orderId, MEV_PROTECTION_WINDOW);
            order.nextExecutionTime = block.timestamp + newDelay;
            
            emit MEVProtectionTriggered(orderId, newDelay, order.nextExecutionTime);
            return ExecutionResult({
                success: false,
                executedAmount: 0,
                averagePrice: 0,
                gasUsed: 0,
                slippage: 0,
                priceImpact: 0
            });
        }
        
        uint256 gasStart = gasleft();
        
        uint256 currentPrice = PERPS_ORACLE.getPerpsOraclePrice(order.asset);
        
        require(
            currentPrice >= order.minPrice && currentPrice <= order.maxPrice,
            "Price out of range"
        );
        
        // Calculate adaptive slice size and interval if enabled
        uint64 executeSize;
        uint256 nextInterval;
        
        if (order.useAdaptiveExecution) {
            executeSize = adaptiveExecutor.calculateAdaptiveSliceSize(
                orderId,
                order.asset,
                order.totalSize - order.executedSize,
                order.baseSliceSize
            );
            
            nextInterval = adaptiveExecutor.calculateAdaptiveInterval(
                orderId,
                order.asset,
                order.baseInterval
            );
        } else {
            executeSize = order.baseSliceSize;
            nextInterval = order.baseInterval;
        }
        
        // Ensure we don't exceed remaining order size
        if (order.executedSize + executeSize > order.totalSize) {
            executeSize = order.totalSize - order.executedSize;
        }
        
        // Calculate price impact before execution
        uint256 priceImpact = adaptiveExecutor.calculatePriceImpact(
            order.asset,
            executeSize,
            order.isBuy
        );
        
        bytes memory limitOrderData = _encodeLimitOrder(
            order.asset,
            order.isBuy,
            currentPrice,
            executeSize,
            false,
            3,
            uint128(uint256(orderId))
        );
        
        CORE_WRITER.sendRawAction(limitOrderData);
        
        order.executedSize += executeSize;
        
        // Add random jitter to next execution time for MEV protection
        uint256 jitter = privacyManager.generateRandomDelay(orderId, nextInterval / 4);
        order.nextExecutionTime = block.timestamp + nextInterval + jitter;
        
        // Calculate slippage
        uint256 slippage = _calculateSlippage(uint64(currentPrice), currentPrice);
        uint256 gasUsed = gasStart - gasleft();
        
        // Record execution metrics
        performanceTracker.recordExecution(
            orderId,
            order.asset,
            executeSize,
            uint64(currentPrice),
            uint64(currentPrice),
            gasUsed,
            block.timestamp - order.nextExecutionTime
        );
        
        emit TWAPSliceExecuted(
            orderId,
            executeSize,
            uint64(currentPrice),
            slippage,
            gasUsed,
            block.timestamp
        );
        
        if (order.executedSize >= order.totalSize) {
            order.active = false;
            
            uint64 avgPrice = _calculateAveragePrice(orderId);
            
            // Complete performance tracking
            performanceTracker.completeOrderTracking(orderId, currentPrice);
            
            emit TWAPOrderCompleted(
                orderId,
                order.executedSize,
                avgPrice,
                0 // Performance score will be calculated in tracker
            );
        }
        
        return ExecutionResult({
            success: true,
            executedAmount: executeSize,
            averagePrice: uint64(currentPrice),
            gasUsed: gasUsed,
            slippage: slippage,
            priceImpact: priceImpact
        });
    }
    
    function _encodeLimitOrder(
        uint32 asset,
        bool isBuy,
        uint256 limitPx,
        uint64 sz,
        bool reduceOnly,
        uint8 tif,
        uint128 cloid
    ) private pure returns (bytes memory) {
        bytes memory encodedAction = abi.encode(
            asset,
            isBuy,
            uint64(limitPx),
            sz,
            reduceOnly,
            tif,
            cloid
        );
        
        bytes memory data = new bytes(4 + encodedAction.length);
        data[0] = 0x01;
        data[1] = 0x00;
        data[2] = 0x00;
        data[3] = 0x01;
        
        for (uint256 i = 0; i < encodedAction.length; i++) {
            data[4 + i] = encodedAction[i];
        }
        
        return data;
    }
    
    function _calculateAveragePrice(bytes32 orderId) private view returns (uint64) {
        return 0;
    }
    
    function cancelTWAPOrder(bytes32 orderId) external onlyOrderOwner(orderId) {
        TWAPOrder storage order = shieldedOrders[orderId];
        require(order.active, "Order not active");
        
        order.active = false;
        
        if (order.executedSize > 0) {
            bytes memory cancelData = _encodeCancelOrder(
                order.asset,
                uint64(uint256(orderId))
            );
            CORE_WRITER.sendRawAction(cancelData);
        }
    }
    
    function _encodeCancelOrder(
        uint32 asset,
        uint64 oid
    ) private pure returns (bytes memory) {
        bytes memory encodedAction = abi.encode(asset, oid);
        
        bytes memory data = new bytes(4 + encodedAction.length);
        data[0] = 0x01;
        data[1] = 0x00;
        data[2] = 0x00;
        data[3] = 0x0A;
        
        for (uint256 i = 0; i < encodedAction.length; i++) {
            data[4 + i] = encodedAction[i];
        }
        
        return data;
    }
    
    function getOrderStatus(bytes32 orderId) external view returns (
        bool active,
        uint64 executedSize,
        uint64 totalSize,
        uint256 nextExecutionTime
    ) {
        TWAPOrder memory order = shieldedOrders[orderId];
        return (
            order.active,
            order.executedSize,
            order.totalSize,
            order.nextExecutionTime
        );
    }
    
    function getUserOrders(address user) external view returns (bytes32[] memory) {
        return userOrders[user];
    }
    
    /**
     * @dev Create a batch order for multiple TWAP executions
     */
    function createBatchOrder(
        bytes32[] calldata orderIds
    ) external returns (bytes32 batchId) {
        require(orderIds.length > 0 && orderIds.length <= MAX_BATCH_SIZE, "Invalid batch size");
        
        // Verify all orders belong to sender and are ready for execution
        for (uint256 i = 0; i < orderIds.length; i++) {
            TWAPOrder memory order = shieldedOrders[orderIds[i]];
            require(order.owner == msg.sender, "Not order owner");
            require(order.active, "Order not active");
            require(block.timestamp >= order.nextExecutionTime, "Order not ready");
        }
        
        // Generate merkle root for batch verification
        bytes32 merkleRoot = privacyManager.generateMerkleRoot(orderIds);
        
        batchId = keccak256(abi.encodePacked(
            msg.sender,
            merkleRoot,
            block.timestamp,
            nonce++
        ));
        
        batchOrders[batchId] = BatchOrder({
            orderIds: orderIds,
            merkleRoot: merkleRoot,
            executionTime: block.timestamp,
            executed: false
        });
        
        emit BatchOrderCreated(batchId, merkleRoot, orderIds.length);
        
        return batchId;
    }
    
    /**
     * @dev Execute a batch of TWAP orders atomically
     */
    function executeBatchOrder(
        bytes32 batchId,
        bytes32[] calldata secrets
    ) external returns (bool success) {
        BatchOrder storage batch = batchOrders[batchId];
        require(!batch.executed, "Batch already executed");
        require(secrets.length == batch.orderIds.length, "Secret count mismatch");
        
        uint256 totalGasUsed = 0;
        uint256 executedCount = 0;
        uint256 gasStart = gasleft();
        
        // Execute all orders in batch
        for (uint256 i = 0; i < batch.orderIds.length; i++) {
            bytes32 orderId = batch.orderIds[i];
            
            // Use try-catch to continue batch execution even if individual orders fail
            try this.executeTWAPSlice(orderId, secrets[i]) returns (ExecutionResult memory result) {
                if (result.success) {
                    executedCount++;
                }
            } catch {
                // Log failed execution but continue with batch
            }
        }
        
        batch.executed = true;
        totalGasUsed = gasStart - gasleft();
        
        emit BatchOrderExecuted(batchId, executedCount, totalGasUsed);
        
        return executedCount > 0;
    }
    
    /**
     * @dev Create order using commit-reveal scheme for enhanced privacy
     */
    function createCommitRevealOrder(
        bytes32 commitment,
        uint256 revealTime
    ) external returns (bytes32 commitmentHash) {
        return privacyManager.commitOrder(commitment, revealTime);
    }
    
    /**
     * @dev Reveal and execute committed order
     */
    function revealAndCreateOrder(
        bytes32 commitmentHash,
        uint32 asset,
        uint64 totalSize,
        uint64 baseSliceSize,
        uint256 baseInterval,
        uint64 minPrice,
        uint64 maxPrice,
        bool isBuy,
        uint256 revealNonce,
        bytes32 secret,
        bool useAdaptiveExecution
    ) external returns (bytes32 orderId) {
        // First reveal the commitment
        bool revealed = privacyManager.revealOrder(
            commitmentHash,
            asset,
            totalSize,
            baseSliceSize,
            baseInterval,
            minPrice,
            maxPrice,
            isBuy,
            revealNonce,
            secret
        );
        
        require(revealed, "Failed to reveal commitment");
        
        // Then create the actual TWAP order
        return createShieldedTWAP(
            asset,
            totalSize,
            baseSliceSize,
            baseInterval,
            minPrice,
            maxPrice,
            isBuy,
            secret,
            useAdaptiveExecution,
            commitmentHash
        );
    }
    
    /**
     * @dev Get comprehensive order analytics
     */
    function getOrderAnalytics(bytes32 orderId) external view returns (
        uint256 currentSlippage,
        uint256 averageGasUsed,
        uint256 executionEfficiency,
        uint256 priceDeviation
    ) {
        // Get performance data from tracker
        (
            PerformanceTracker.OrderPerformance memory performance,
            PerformanceTracker.ExecutionMetrics[] memory executions,
            uint256 totalSlices,
            uint256 avgSlippage,
            uint256 avgGasPerSlice
        ) = performanceTracker.getOrderPerformanceReport(orderId);
        
        currentSlippage = avgSlippage;
        averageGasUsed = avgGasPerSlice;
        executionEfficiency = performance.performanceScore;
        
        if (performance.benchmarkPrice > 0 && performance.averageExecutionPrice > 0) {
            priceDeviation = performance.averageExecutionPrice > performance.benchmarkPrice ?
                performance.averageExecutionPrice - performance.benchmarkPrice :
                performance.benchmarkPrice - performance.averageExecutionPrice;
            priceDeviation = (priceDeviation * 10000) / performance.benchmarkPrice; // In basis points
        }
    }
    
    /**
     * @dev Emergency pause functionality for MEV attacks
     */
    function emergencyPauseOrder(bytes32 orderId) external onlyOrderOwner(orderId) {
        TWAPOrder storage order = shieldedOrders[orderId];
        
        // Add random delay to prevent MEV exploitation
        uint256 emergencyDelay = privacyManager.generateRandomDelay(orderId, MEV_PROTECTION_WINDOW * 2);
        order.nextExecutionTime = block.timestamp + emergencyDelay;
        
        emit MEVProtectionTriggered(orderId, emergencyDelay, order.nextExecutionTime);
    }
    
    /**
     * @dev Get optimal execution timing recommendation
     */
    function getOptimalExecutionTiming(bytes32 orderId) external view returns (
        uint256 recommendedDelay,
        uint256 marketVolatility,
        uint256 liquidityDepth,
        bool shouldWait
    ) {
        TWAPOrder memory order = shieldedOrders[orderId];
        
        recommendedDelay = adaptiveExecutor.getOptimalExecutionTiming(order.asset);
        
        // Get market conditions
        AdaptiveExecutor.MarketConditions memory conditions = adaptiveExecutor.getMarketConditions(order.asset);
        marketVolatility = conditions.volatility;
        liquidityDepth = conditions.liquidity;
        
        // Recommend waiting if market conditions are unfavorable
        shouldWait = (conditions.volatility > 1e18) || (conditions.liquidity < 1000e18);
    }
    
    /**
     * @dev Calculate slippage for execution analysis
     */
    function _calculateSlippage(uint64 executionPrice, uint256 marketPrice) internal pure returns (uint256) {
        if (marketPrice == 0) return 0;
        
        uint256 difference = uint256(executionPrice) > marketPrice ? 
            uint256(executionPrice) - marketPrice : marketPrice - uint256(executionPrice);
        
        return (difference * 10000) / marketPrice; // Return in basis points
    }
    
    /**
     * @dev Generate MEV protection delay
     */
    function _generateMEVDelay(bytes32 orderId, uint256 randomSeed) internal view returns (uint256) {
        // Generate random delay between 0 and MEV_PROTECTION_WINDOW
        return (randomSeed % MEV_PROTECTION_WINDOW) + MIN_INTERVAL;
    }
}