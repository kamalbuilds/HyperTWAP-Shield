// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ICoreWriter.sol";
import "./interfaces/IL1Read.sol";

contract CoreEVMArbitrage {
    struct ArbitrageParams {
        uint32 asset;
        uint64 amount;
        uint64 minProfit;
        bool isBuy;
        address[] path;
    }
    
    struct ArbitrageResult {
        bool executed;
        uint64 profit;
        uint256 gasUsed;
        bytes executionData;
    }
    
    ICoreWriter constant CORE_WRITER = ICoreWriter(0x3333333333333333333333333333333333333333);
    IPerpsOracles constant PERPS_ORACLE = IPerpsOracles(0x0000000000000000000000000000000000000807);
    ISpotOracles constant SPOT_ORACLE = ISpotOracles(0x0000000000000000000000000000000000000808);
    
    address public owner;
    mapping(address => bool) public authorized;
    
    uint256 private constant ACTION_VERSION = 1;
    uint256 private constant LIMIT_ORDER_ACTION = 1;
    uint256 private constant USD_TRANSFER_ACTION = 7;
    
    event ArbitrageExecuted(
        address indexed executor,
        uint32 indexed asset,
        uint64 profit,
        uint256 timestamp
    );
    
    event ArbitrageOpportunity(
        uint32 indexed asset,
        uint256 corePrice,
        uint256 evmPrice,
        uint256 spread
    );
    
    modifier onlyAuthorized() {
        require(authorized[msg.sender] || msg.sender == owner, "Unauthorized");
        _;
    }
    
    constructor() {
        owner = msg.sender;
        authorized[msg.sender] = true;
    }
    
    function detectArbitrage(
        uint32[] calldata assets
    ) external view returns (uint32[] memory opportunities, uint256[] memory spreads) {
        uint256 count = 0;
        uint32[] memory tempAssets = new uint32[](assets.length);
        uint256[] memory tempSpreads = new uint256[](assets.length);
        
        for (uint256 i = 0; i < assets.length; i++) {
            uint256 perpPrice = PERPS_ORACLE.getPerpsOraclePrice(assets[i]);
            uint256 spotPrice = SPOT_ORACLE.getSpotOraclePrice(assets[i]);
            
            uint256 spread = perpPrice > spotPrice ? 
                ((perpPrice - spotPrice) * 10000) / spotPrice :
                ((spotPrice - perpPrice) * 10000) / perpPrice;
            
            if (spread > 10) {
                tempAssets[count] = assets[i];
                tempSpreads[count] = spread;
                count++;
            }
        }
        
        opportunities = new uint32[](count);
        spreads = new uint256[](count);
        
        for (uint256 i = 0; i < count; i++) {
            opportunities[i] = tempAssets[i];
            spreads[i] = tempSpreads[i];
        }
        
        return (opportunities, spreads);
    }
    
    function executeArbitrage(
        ArbitrageParams calldata params
    ) external onlyAuthorized returns (ArbitrageResult memory) {
        uint256 gasStart = gasleft();
        
        uint256 perpPrice = PERPS_ORACLE.getPerpsOraclePrice(params.asset);
        uint256 spotPrice = SPOT_ORACLE.getSpotOraclePrice(params.asset);
        
        require(
            perpPrice > spotPrice + params.minProfit || 
            spotPrice > perpPrice + params.minProfit,
            "Insufficient spread"
        );
        
        bytes memory limitOrderData = _encodeLimitOrder(
            params.asset,
            params.isBuy,
            params.isBuy ? spotPrice : perpPrice,
            params.amount,
            false,
            2,
            0
        );
        
        CORE_WRITER.sendRawAction(limitOrderData);
        
        bytes memory transferData = _encodeUSDTransfer(
            params.amount,
            !params.isBuy
        );
        
        CORE_WRITER.sendRawAction(transferData);
        
        uint64 estimatedProfit = _calculateProfit(
            perpPrice,
            spotPrice,
            params.amount,
            params.isBuy
        );
        
        emit ArbitrageExecuted(
            msg.sender,
            params.asset,
            estimatedProfit,
            block.timestamp
        );
        
        return ArbitrageResult({
            executed: true,
            profit: estimatedProfit,
            gasUsed: gasStart - gasleft(),
            executionData: abi.encode(limitOrderData, transferData)
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
        data[0] = bytes1(uint8(ACTION_VERSION));
        data[1] = 0x00;
        data[2] = 0x00;
        data[3] = bytes1(uint8(LIMIT_ORDER_ACTION));
        
        for (uint256 i = 0; i < encodedAction.length; i++) {
            data[4 + i] = encodedAction[i];
        }
        
        return data;
    }
    
    function _encodeUSDTransfer(
        uint64 ntl,
        bool toPerp
    ) private pure returns (bytes memory) {
        bytes memory encodedAction = abi.encode(ntl, toPerp);
        
        bytes memory data = new bytes(4 + encodedAction.length);
        data[0] = bytes1(uint8(ACTION_VERSION));
        data[1] = 0x00;
        data[2] = 0x00;
        data[3] = bytes1(uint8(USD_TRANSFER_ACTION));
        
        for (uint256 i = 0; i < encodedAction.length; i++) {
            data[4 + i] = encodedAction[i];
        }
        
        return data;
    }
    
    function _calculateProfit(
        uint256 perpPrice,
        uint256 spotPrice,
        uint64 amount,
        bool isBuy
    ) private pure returns (uint64) {
        uint256 spread = perpPrice > spotPrice ?
            perpPrice - spotPrice : spotPrice - perpPrice;
        
        return uint64((spread * amount) / 1e8);
    }
    
    function updateAuthorization(address user, bool authorized_) external {
        require(msg.sender == owner, "Only owner");
        authorized[user] = authorized_;
    }
    
    function withdrawProfit() external {
        require(msg.sender == owner, "Only owner");
        payable(owner).transfer(address(this).balance);
    }
    
    receive() external payable {}
}