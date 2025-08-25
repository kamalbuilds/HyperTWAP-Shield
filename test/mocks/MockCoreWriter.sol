// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../../contracts/interfaces/ICoreWriter.sol";

/**
 * Mock implementation of ICoreWriter for testing
 * Simulates the behavior of the actual CoreWriter without executing real trades
 */
contract MockCoreWriter is ICoreWriter {
    struct ActionRecord {
        address sender;
        bytes data;
        uint256 timestamp;
        uint256 blockNumber;
    }

    mapping(uint256 => ActionRecord) public actionHistory;
    uint256 public actionCount;
    
    bool public shouldFailNext;
    bytes public lastActionData;
    address public lastSender;
    
    // Statistics for testing
    uint256 public totalActionsReceived;
    uint256 public totalGasUsed;
    
    // Configurable behavior
    uint256 public simulatedGasCost = 21000;
    bool public isActive = true;

    event ActionReceived(address indexed sender, bytes data, uint256 actionId);
    event MockConfigUpdated(string parameter, uint256 value);

    modifier onlyWhenActive() {
        require(isActive, "MockCoreWriter is inactive");
        _;
    }

    /**
     * Main interface function - receives raw action data
     */
    function sendRawAction(bytes calldata data) external override onlyWhenActive {
        require(data.length > 0, "Empty action data");
        
        if (shouldFailNext) {
            shouldFailNext = false;
            revert("MockCoreWriter: Simulated failure");
        }

        // Record the action
        actionHistory[actionCount] = ActionRecord({
            sender: msg.sender,
            data: data,
            timestamp: block.timestamp,
            blockNumber: block.number
        });

        // Update state
        lastActionData = data;
        lastSender = msg.sender;
        totalActionsReceived++;
        actionCount++;

        // Simulate gas consumption
        totalGasUsed += simulatedGasCost;

        emit ActionSent(msg.sender, data);
        emit ActionReceived(msg.sender, data, actionCount - 1);
    }

    /**
     * Configure mock to fail on next call
     */
    function setNextCallShouldFail(bool shouldFail) external {
        shouldFailNext = shouldFail;
    }

    /**
     * Set simulated gas cost for actions
     */
    function setSimulatedGasCost(uint256 gasCost) external {
        simulatedGasCost = gasCost;
        emit MockConfigUpdated("simulatedGasCost", gasCost);
    }

    /**
     * Enable/disable the mock
     */
    function setActive(bool active) external {
        isActive = active;
        emit MockConfigUpdated("isActive", active ? 1 : 0);
    }

    /**
     * Get action by ID
     */
    function getAction(uint256 actionId) external view returns (ActionRecord memory) {
        require(actionId < actionCount, "Action ID out of bounds");
        return actionHistory[actionId];
    }

    /**
     * Get actions for a specific sender
     */
    function getActionsForSender(address sender) external view returns (uint256[] memory) {
        uint256[] memory tempIds = new uint256[](actionCount);
        uint256 count = 0;
        
        for (uint256 i = 0; i < actionCount; i++) {
            if (actionHistory[i].sender == sender) {
                tempIds[count] = i;
                count++;
            }
        }
        
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = tempIds[i];
        }
        
        return result;
    }

    /**
     * Decode limit order action (for testing validation)
     */
    function decodeLimitOrder(bytes calldata data) external pure returns (
        uint32 asset,
        bool isBuy,
        uint64 limitPx,
        uint64 sz,
        bool reduceOnly,
        uint8 tif,
        uint128 cloid
    ) {
        require(data.length >= 4, "Data too short");
        
        // Check action type (should be 0x01000001 for limit order)
        bytes4 actionType = bytes4(data[0:4]);
        require(actionType == 0x01000001, "Not a limit order action");
        
        // Decode the parameters
        bytes memory params = data[4:];
        (asset, isBuy, limitPx, sz, reduceOnly, tif, cloid) = abi.decode(
            params,
            (uint32, bool, uint64, uint64, bool, uint8, uint128)
        );
    }

    /**
     * Decode cancel order action (for testing validation)
     */
    function decodeCancelOrder(bytes calldata data) external pure returns (
        uint32 asset,
        uint64 oid
    ) {
        require(data.length >= 4, "Data too short");
        
        // Check action type (should be 0x0100000A for cancel order)
        bytes4 actionType = bytes4(data[0:4]);
        require(actionType == 0x0100000A, "Not a cancel order action");
        
        // Decode the parameters
        bytes memory params = data[4:];
        (asset, oid) = abi.decode(params, (uint32, uint64));
    }

    /**
     * Validate that action data is properly formatted
     */
    function validateActionData(bytes calldata data) external pure returns (bool) {
        if (data.length < 4) return false;
        
        bytes4 actionType = bytes4(data[0:4]);
        
        // Check known action types
        if (actionType == 0x01000001) { // Limit order
            if (data.length < 4 + 32 * 7) return false; // Minimum size for limit order
            return true;
        } else if (actionType == 0x0100000A) { // Cancel order
            if (data.length < 4 + 32 * 2) return false; // Minimum size for cancel order
            return true;
        }
        
        return false; // Unknown action type
    }

    /**
     * Get statistics for testing analysis
     */
    function getStatistics() external view returns (
        uint256 totalActions,
        uint256 gasUsed,
        uint256 averageGasPerAction,
        bool active
    ) {
        totalActions = totalActionsReceived;
        gasUsed = totalGasUsed;
        averageGasPerAction = totalActions > 0 ? gasUsed / totalActions : 0;
        active = isActive;
    }

    /**
     * Reset mock state for fresh testing
     */
    function reset() external {
        actionCount = 0;
        totalActionsReceived = 0;
        totalGasUsed = 0;
        shouldFailNext = false;
        lastActionData = "";
        lastSender = address(0);
        isActive = true;
        simulatedGasCost = 21000;
    }

    /**
     * Simulate processing delay
     */
    function simulateProcessingDelay(uint256 delayBlocks) external {
        uint256 targetBlock = block.number + delayBlocks;
        // In real testing, you'd use time manipulation functions
        // This is just for interface completeness
        emit MockConfigUpdated("simulatedDelay", delayBlocks);
    }

    /**
     * Check if an action would succeed (for staticCall testing)
     */
    function wouldActionSucceed(bytes calldata data) external view returns (bool) {
        if (!isActive) return false;
        if (shouldFailNext) return false;
        if (data.length == 0) return false;
        return validateActionData(data);
    }

    /**
     * Get the last N actions
     */
    function getRecentActions(uint256 count) external view returns (ActionRecord[] memory) {
        if (count > actionCount) count = actionCount;
        
        ActionRecord[] memory recent = new ActionRecord[](count);
        uint256 startIndex = actionCount - count;
        
        for (uint256 i = 0; i < count; i++) {
            recent[i] = actionHistory[startIndex + i];
        }
        
        return recent;
    }

    /**
     * Emergency stop function
     */
    function emergencyStop() external {
        isActive = false;
        emit MockConfigUpdated("emergencyStop", 1);
    }

    /**
     * Resume operations after emergency stop
     */
    function resume() external {
        isActive = true;
        emit MockConfigUpdated("resume", 1);
    }
}