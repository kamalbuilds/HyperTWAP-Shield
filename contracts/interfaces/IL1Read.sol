// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IL1BlockNumber {
    function getL1BlockNumber() external view returns (uint256);
}

interface ISpotBalances {
    function getSpotBalance(address user, uint32 token) external view returns (int256);
}

interface IPerpsPositions {
    function getPerpsPosition(address user, uint32 asset) external view returns (int256 szi, int256 ntl);
}

interface IPerpsOracles {
    function getPerpsOraclePrice(uint32 asset) external view returns (uint256 price);
}

interface ISpotOracles {
    function getSpotOraclePrice(uint32 token) external view returns (uint256 price);
}

interface IVaultEquity {
    function getVaultEquity(address vault) external view returns (uint256 equity);
}

interface IStakingDelegations {
    function getStakingDelegation(address user, address validator) external view returns (uint256 amount);
}