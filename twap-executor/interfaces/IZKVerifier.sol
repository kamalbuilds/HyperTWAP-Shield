// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IZKVerifier
 * @dev Interface for zero-knowledge proof verifier
 */
interface IZKVerifier {
    /**
     * @dev Verify a zk-SNARK proof
     * @param a First element of the proof
     * @param b Second element of the proof  
     * @param c Third element of the proof
     * @param input Public inputs to the proof
     * @return True if proof is valid, false otherwise
     */
    function verifyProof(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[] memory input
    ) external view returns (bool);
    
    /**
     * @dev Verify a proof with additional context
     * @param proof The complete proof structure
     * @param publicSignals Public signals/inputs
     * @param circuitId Identifier for the circuit being verified
     * @return isValid True if proof is valid
     */
    function verifyProofWithCircuit(
        bytes memory proof,
        uint256[] memory publicSignals,
        bytes32 circuitId
    ) external view returns (bool isValid);
    
    /**
     * @dev Get supported circuit information
     * @param circuitId The circuit identifier
     * @return isSupported Whether the circuit is supported
     * @return inputCount Expected number of public inputs
     */
    function getCircuitInfo(bytes32 circuitId) external view returns (bool isSupported, uint256 inputCount);
}