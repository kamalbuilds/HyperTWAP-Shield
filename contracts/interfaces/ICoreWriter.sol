// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICoreWriter {
    function sendRawAction(bytes calldata data) external;
    
    event ActionSent(address indexed sender, bytes data);
}