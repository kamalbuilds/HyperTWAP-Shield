// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ICoreWriter.sol";
import "./interfaces/IL1Read.sol";

/**
 * @title ShieldedTWAPExecutorV2
 * @notice Advanced TWAP order executor with privacy, adaptive execution, and HyperCore integration
 * @dev Leverages HyperCore precompiles for price discovery and state validation
 */
contract ShieldedTWAPExecutorV2 {
    // Precompile addresses for HyperCore integration
    address constant L1_BLOCK_NUMBER = 0x0000000000000000000000000000000000000809;
    address constant PERPS_ORACLE = 0x0000000000000000000000000000000000000807;
    address constant SPOT_ORACLE = 0x0000000000000000000000000000000000000808;
    address constant BBO_PRECOMPILE = 0x000000000000000000000000000000000000080e;
    address constant ACCOUNT_MARGIN = 0x000000000000000000000000000000000000080F;
    address constant SPOT_BALANCE = 0x0000000000000000000000000000000000000801;
    
    ICoreWriter constant CORE_WRITER = ICoreWriter(0x3333333333333333333333333333333333333333);
    
    struct TWAPOrder {
        uint32 asset;
        uint64 totalSize;
        uint64 executedSize;
        uint64 sliceSize;
        uint64 minPrice;
        uint64 maxPrice;
        uint256 interval;
        uint256 nextExecutionTime;
        uint256 l1BlockAtCreation;  // L1 block synchronization
        uint256 commitTimestamp;     // Commit-reveal timestamp
        bool isBuy;
        bool active;
        bool useAdaptiveSlicing;     // Enable dynamic slice adjustment
        bool useBBO;                 // Use best bid/offer for execution
        address owner;
        bytes32 secretHash;
        bytes32 commitHash;          // Commit-reveal pattern
    }
    
    struct ExecutionResult {
        bool success;
        uint64 executedAmount;
        uint64 averagePrice;
        uint256 gasUsed;
        uint256 slippage;
        uint256 marketImpact;
    }
    
    struct MarketConditions {
        uint64 bidPrice;
        uint64 askPrice;
        uint256 spread;
        uint256 volatility;
        uint256 liquidity;
        uint256 l1Block;
    }
    
    mapping(bytes32 => TWAPOrder) private shieldedOrders;
    mapping(address => bytes32[]) private userOrders;
    mapping(bytes32 => uint256[]) private executionPrices;
    mapping(uint32 => uint256) private lastVolatilityCheck;
    mapping(uint32 => uint256) private cachedVolatility;
    mapping(uint32 => MarketConditions) private marketConditionsCache;
    
    uint256 private orderNonce;
    uint256 private constant MIN_INTERVAL = 60;
    uint256 private constant MAX_SLICES = 100;
    uint256 private constant COMMIT_REVEAL_DELAY = 30;
    uint256 private constant MEV_PROTECTION_DELAY = 5;
    uint256 private constant ADAPTIVE_FACTOR = 150;
    uint256 private constant HIGH_VOLATILITY_THRESHOLD = 500;
    uint256 private constant LOW_LIQUIDITY_THRESHOLD = 10000;
    uint256 private constant VOLATILITY_CACHE_DURATION = 300;
    
    event TWAPOrderCreated(
        bytes32 indexed orderId,
        address indexed owner,
        uint32 asset,
        uint64 totalSize,
        bool useAdaptiveSlicing,
        bool useBBO
    );
    
    event TWAPSliceExecuted(
        bytes32 indexed orderId,
        uint64 executedSize,
        uint64 price,
        uint256 timestamp,
        uint256 marketImpact
    );
    
    event TWAPOrderCompleted(
        bytes32 indexed orderId,
        uint64 totalExecuted,
        uint64 averagePrice,
        uint256 totalSlippage
    );
    
    event CommitRegistered(
        bytes32 indexed orderId,
        bytes32 commitHash,
        uint256 timestamp
    );
    
    event MarketConditionsUpdated(
        uint32 indexed asset,
        uint256 volatility,
        uint256 spread
    );
    
    modifier onlyOrderOwner(bytes32 orderId) {
        require(shieldedOrders[orderId].owner == msg.sender, "Not order owner");
        _;
    }
    
    /**
     * @notice Create a new shielded TWAP order with advanced features
     */
    function createShieldedTWAP(
        uint32 asset,
        uint64 totalSize,
        uint64 sliceSize,
        uint256 interval,
        uint64 minPrice,
        uint64 maxPrice,
        bool isBuy,
        bool useAdaptiveSlicing,
        bool useBBO,
        bytes32 secret
    ) external returns (bytes32) {
        require(totalSize > 0 && sliceSize > 0, "Invalid sizes");
        require(totalSize >= sliceSize, "Slice too large");
        require(interval >= MIN_INTERVAL, "Interval too short");
        require(totalSize / sliceSize <= MAX_SLICES, "Too many slices");
        require(maxPrice > minPrice, "Invalid price range");
        
        bytes32 orderId = keccak256(
            abi.encodePacked(msg.sender, asset, totalSize, orderNonce++, secret)
        );
        
        uint256 jitter = _generateRandomJitter();
        
        shieldedOrders[orderId] = TWAPOrder({
            asset: asset,
            totalSize: totalSize,
            executedSize: 0,
            sliceSize: sliceSize,
            minPrice: minPrice,
            maxPrice: maxPrice,
            interval: interval,
            nextExecutionTime: block.timestamp + jitter,
            l1BlockAtCreation: _getL1BlockNumber(),
            commitTimestamp: 0,
            isBuy: isBuy,
            active: true,
            useAdaptiveSlicing: useAdaptiveSlicing,
            useBBO: useBBO,
            owner: msg.sender,
            secretHash: keccak256(abi.encodePacked(secret)),
            commitHash: bytes32(0)
        });
        
        userOrders[msg.sender].push(orderId);
        
        emit TWAPOrderCreated(orderId, msg.sender, asset, totalSize, useAdaptiveSlicing, useBBO);
        
        return orderId;
    }
    
    /**
     * @notice Execute a TWAP slice with commit-reveal validation
     */
    function executeTWAPSlice(
        bytes32 orderId,
        bytes32 secret,
        bytes32 revealNonce
    ) external returns (ExecutionResult memory) {
        TWAPOrder storage order = shieldedOrders[orderId];
        
        require(order.active, "Order not active");
        require(
            keccak256(abi.encodePacked(secret)) == order.secretHash,
            "Invalid secret"
        );
        
        // Commit-reveal validation
        if (order.commitHash != bytes32(0)) {
            require(
                block.timestamp >= order.commitTimestamp + COMMIT_REVEAL_DELAY,
                "Reveal too early"
            );
            require(
                keccak256(abi.encodePacked(orderId, revealNonce)) == order.commitHash,
                "Invalid reveal"
            );
            order.commitHash = bytes32(0); // Reset for next execution
        }
        
        require(
            block.timestamp >= order.nextExecutionTime,
            "Too early for execution"
        );
        
        uint256 gasStart = gasleft();
        
        // Get current market conditions
        MarketConditions memory conditions = _getMarketConditions(order.asset, order.useBBO);
        
        // Price validation
        uint256 currentPrice = order.isBuy ? conditions.askPrice : conditions.bidPrice;
        require(
            currentPrice >= order.minPrice && currentPrice <= order.maxPrice,
            "Price out of range"
        );
        
        // Calculate execution size
        uint64 executeSize = order.useAdaptiveSlicing 
            ? _calculateAdaptiveSliceSize(order, conditions)
            : order.sliceSize;
            
        if (order.executedSize + executeSize > order.totalSize) {
            executeSize = order.totalSize - order.executedSize;
        }
        
        // Validate account margin
        _validateAccountMargin(order.owner, order.asset, executeSize);
        
        // Execute the order slice
        bytes memory limitOrderData = _encodeLimitOrder(
            order.asset,
            order.isBuy,
            currentPrice,
            executeSize,
            false,
            3, // IOC
            uint128(uint256(orderId))
        );
        
        CORE_WRITER.sendRawAction(limitOrderData);
        
        // Update order state
        order.executedSize += executeSize;
        uint256 jitter = _generateRandomJitter();
        order.nextExecutionTime = block.timestamp + order.interval + jitter;
        
        // Track execution price
        executionPrices[orderId].push(currentPrice);
        
        // Calculate market impact
        uint256 marketImpact = _calculateMarketImpact(executeSize, conditions);
        
        emit TWAPSliceExecuted(
            orderId,
            executeSize,
            uint64(currentPrice),
            block.timestamp,
            marketImpact
        );
        
        // Check if order is complete
        if (order.executedSize >= order.totalSize) {
            order.active = false;
            
            uint64 avgPrice = _calculateAveragePrice(orderId);
            uint256 totalSlippage = _calculateTotalSlippage(orderId, avgPrice);
            
            emit TWAPOrderCompleted(
                orderId,
                order.executedSize,
                avgPrice,
                totalSlippage
            );
        }
        
        return ExecutionResult({
            success: true,
            executedAmount: executeSize,
            averagePrice: uint64(currentPrice),
            gasUsed: gasStart - gasleft(),
            slippage: _calculateSlippage(currentPrice, order.isBuy ? order.minPrice : order.maxPrice),
            marketImpact: marketImpact
        });
    }
    
    /**
     * @notice Commit to execute a TWAP slice (commit-reveal pattern)
     */
    function commitToExecute(bytes32 orderId, bytes32 commitHash) external {
        TWAPOrder storage order = shieldedOrders[orderId];
        require(order.active, "Order not active");
        require(order.commitHash == bytes32(0), "Already committed");
        
        order.commitHash = commitHash;
        order.commitTimestamp = block.timestamp;
        
        emit CommitRegistered(orderId, commitHash, block.timestamp);
    }
    
    /**
     * @notice Cancel a TWAP order
     */
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
    
    /**
     * @notice Get enhanced order status with analytics
     */
    function getOrderStatus(bytes32 orderId) external view returns (
        bool active,
        uint64 executedSize,
        uint64 totalSize,
        uint256 nextExecutionTime,
        uint64 averagePrice,
        uint256 remainingSlices
    ) {
        TWAPOrder memory order = shieldedOrders[orderId];
        uint256 remaining = order.totalSize > order.executedSize 
            ? (order.totalSize - order.executedSize) / order.sliceSize 
            : 0;
            
        return (
            order.active,
            order.executedSize,
            order.totalSize,
            order.nextExecutionTime,
            _calculateAveragePrice(orderId),
            remaining
        );
    }
    
    /**
     * @notice Get market analytics for an asset
     */
    function getMarketAnalytics(uint32 asset) external view returns (
        uint64 bidPrice,
        uint64 askPrice,
        uint256 spread,
        uint256 volatility,
        uint256 l1Block
    ) {
        MarketConditions memory conditions = _getMarketConditions(asset, true);
        return (
            conditions.bidPrice,
            conditions.askPrice,
            conditions.spread,
            conditions.volatility,
            conditions.l1Block
        );
    }
    
    /**
     * @notice Get user's orders
     */
    function getUserOrders(address user) external view returns (bytes32[] memory) {
        return userOrders[user];
    }
    
    // Internal helper functions
    
    function _getMarketConditions(uint32 asset, bool useBBO) private view returns (MarketConditions memory) {
        MarketConditions memory conditions;
        
        if (useBBO) {
            (conditions.bidPrice, conditions.askPrice) = _getBBO(asset);
        } else {
            uint64 oraclePrice = uint64(_getOraclePrice(asset));
            conditions.bidPrice = oraclePrice;
            conditions.askPrice = oraclePrice;
        }
        
        conditions.spread = conditions.askPrice > conditions.bidPrice 
            ? conditions.askPrice - conditions.bidPrice 
            : 0;
        conditions.volatility = _getMarketVolatility(asset);
        conditions.l1Block = _getL1BlockNumber();
        
        return conditions;
    }
    
    function _calculateAdaptiveSliceSize(
        TWAPOrder memory order,
        MarketConditions memory conditions
    ) private pure returns (uint64) {
        uint64 adjustedSize = order.sliceSize;
        
        // Reduce size in high volatility
        if (conditions.volatility > HIGH_VOLATILITY_THRESHOLD) {
            adjustedSize = (adjustedSize * 75) / 100;
        }
        // Increase size in low volatility with tight spreads
        else if (conditions.volatility < 100 && conditions.spread < 10) {
            adjustedSize = uint64((uint256(adjustedSize) * ADAPTIVE_FACTOR) / 100);
        }
        
        return adjustedSize;
    }
    
    function _calculateMarketImpact(
        uint64 size,
        MarketConditions memory conditions
    ) private pure returns (uint256) {
        // Simple linear impact model
        // In production, use square-root or more sophisticated model
        uint256 spreadBps = (conditions.spread * 10000) / conditions.askPrice;
        uint256 sizeBps = (uint256(size) * 10000) / LOW_LIQUIDITY_THRESHOLD;
        
        return (spreadBps * sizeBps) / 100;
    }
    
    function _calculateSlippage(uint256 executionPrice, uint64 targetPrice) private pure returns (uint256) {
        if (executionPrice > targetPrice) {
            return ((executionPrice - targetPrice) * 10000) / targetPrice;
        } else {
            return ((targetPrice - executionPrice) * 10000) / targetPrice;
        }
    }
    
    function _calculateTotalSlippage(bytes32 orderId, uint64 avgPrice) private view returns (uint256) {
        TWAPOrder memory order = shieldedOrders[orderId];
        uint64 midPrice = (order.minPrice + order.maxPrice) / 2;
        return _calculateSlippage(avgPrice, midPrice);
    }
    
    function _calculateAveragePrice(bytes32 orderId) private view returns (uint64) {
        uint256[] memory prices = executionPrices[orderId];
        if (prices.length == 0) return 0;
        
        uint256 sum = 0;
        for (uint256 i = 0; i < prices.length; i++) {
            sum += prices[i];
        }
        return uint64(sum / prices.length);
    }
    
    function _getL1BlockNumber() private view returns (uint256) {
        (bool success, bytes memory result) = L1_BLOCK_NUMBER.staticcall("");
        if (!success) return block.number;
        return abi.decode(result, (uint64));
    }
    
    function _getOraclePrice(uint32 asset) private view returns (uint256) {
        (bool success, bytes memory result) = PERPS_ORACLE.staticcall(abi.encode(asset));
        if (!success) revert("Oracle price read failed");
        return abi.decode(result, (uint64));
    }
    
    
    function _getBBO(uint32 asset) private view returns (uint64 bid, uint64 ask) {
        (bool success, bytes memory result) = BBO_PRECOMPILE.staticcall(abi.encode(asset));
        if (!success) revert("BBO read failed");
        (bid, ask) = abi.decode(result, (uint64, uint64));
    }
    
    function _validateAccountMargin(
        address user,
        uint32 asset,
        uint64 size
    ) private view {
        (bool success, bytes memory result) = ACCOUNT_MARGIN.staticcall(
            abi.encode(0, user)
        );
        if (!success) revert("Margin check failed");
        
        (int64 accountValue, , , ) = abi.decode(
            result,
            (int64, uint64, uint64, int64)
        );
        
        require(accountValue > 0, "Insufficient account value");
    }
    
    function _getMarketVolatility(uint32 asset) private view returns (uint256) {
        if (block.timestamp - lastVolatilityCheck[asset] > VOLATILITY_CACHE_DURATION) {
            return 200; // Default 2% volatility
        }
        return cachedVolatility[asset];
    }
    
    function _generateRandomJitter() private view returns (uint256) {
        uint256 seed = uint256(keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            msg.sender,
            orderNonce
        )));
        return seed % MEV_PROTECTION_DELAY;
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
}