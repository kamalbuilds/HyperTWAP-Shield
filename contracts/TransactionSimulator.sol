// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ICoreWriter.sol";
import "./interfaces/IL1Read.sol";

contract TransactionSimulator {
    struct SimulationResult {
        bool success;
        bytes returnData;
        uint256 gasUsed;
        StateChange[] stateChanges;
        bytes revertReason;
    }
    
    struct StateChange {
        address account;
        bytes32 slot;
        bytes32 oldValue;
        bytes32 newValue;
    }
    
    struct SimulationParams {
        address target;
        bytes callData;
        uint256 value;
        uint256 gasLimit;
        bool includePrecompiles;
    }
    
    address constant CORE_WRITER = 0x3333333333333333333333333333333333333333;
    address constant L1_BLOCK_PRECOMPILE = 0x0000000000000000000000000000000000000800;
    address constant SPOT_BALANCES_PRECOMPILE = 0x0000000000000000000000000000000000000801;
    address constant PERPS_POSITIONS_PRECOMPILE = 0x0000000000000000000000000000000000000802;
    
    mapping(bytes32 => SimulationResult) private simulationCache;
    
    event SimulationExecuted(
        address indexed caller,
        address indexed target,
        bool success,
        uint256 gasUsed
    );
    
    function simulateTransaction(
        SimulationParams calldata params
    ) external returns (SimulationResult memory) {
        bytes32 simulationKey = keccak256(abi.encode(params));
        
        if (simulationCache[simulationKey].gasUsed > 0) {
            return simulationCache[simulationKey];
        }
        
        uint256 gasStart = gasleft();
        
        SimulationResult memory result;
        StateChange[] memory changes = new StateChange[](10);
        uint256 changeCount = 0;
        
        try this._executeSimulation{gas: params.gasLimit}(
            params.target,
            params.callData,
            params.value,
            params.includePrecompiles
        ) returns (bytes memory data) {
            result.success = true;
            result.returnData = data;
        } catch Error(string memory reason) {
            result.success = false;
            result.revertReason = bytes(reason);
        } catch (bytes memory reason) {
            result.success = false;
            result.revertReason = reason;
        }
        
        result.gasUsed = gasStart - gasleft();
        result.stateChanges = changes;
        
        simulationCache[simulationKey] = result;
        
        emit SimulationExecuted(msg.sender, params.target, result.success, result.gasUsed);
        
        return result;
    }
    
    function _executeSimulation(
        address target,
        bytes calldata callData,
        uint256 value,
        bool includePrecompiles
    ) external payable returns (bytes memory) {
        require(msg.sender == address(this), "Internal only");
        
        if (includePrecompiles && target == CORE_WRITER) {
            return _simulateCoreWriterAction(callData);
        }
        
        (bool success, bytes memory data) = target.call{value: value}(callData);
        require(success, "Simulation failed");
        
        return data;
    }
    
    function _simulateCoreWriterAction(bytes calldata data) private pure returns (bytes memory) {
        require(data.length >= 4, "Invalid action data");
        
        uint8 version = uint8(data[0]);
        require(version == 1, "Unsupported version");
        
        uint24 actionId = uint24(bytes3(data[1:4]));
        
        if (actionId == 1) {
            return abi.encode("Limit order simulation");
        } else if (actionId == 2) {
            return abi.encode("Vault transfer simulation");
        } else if (actionId == 7) {
            return abi.encode("USD class transfer simulation");
        }
        
        return data;
    }
    
    function batchSimulate(
        SimulationParams[] calldata params
    ) external returns (SimulationResult[] memory) {
        SimulationResult[] memory results = new SimulationResult[](params.length);
        
        for (uint256 i = 0; i < params.length; i++) {
            results[i] = this.simulateTransaction(params[i]);
        }
        
        return results;
    }
    
    function clearCache() external {
        assembly {
            let slot := simulationCache.slot
            sstore(slot, 0)
        }
    }
}