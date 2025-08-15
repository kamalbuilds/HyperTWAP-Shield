// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IL1Read.sol";

contract OraclePrecompile {
    IPerpsOracles constant PERPS_ORACLE = IPerpsOracles(0x0000000000000000000000000000000000000807);
    ISpotOracles constant SPOT_ORACLE = ISpotOracles(0x0000000000000000000000000000000000000808);
    
    struct PriceData {
        uint256 perpPrice;
        uint256 spotPrice;
        uint256 spread;
        uint256 timestamp;
        bool isValid;
    }
    
    struct AggregatedPrice {
        uint256 price;
        uint256 confidence;
        uint8 decimals;
        uint256 timestamp;
    }
    
    mapping(uint32 => PriceData) private priceCache;
    mapping(uint32 => AggregatedPrice) private aggregatedPrices;
    
    uint256 private constant CACHE_DURATION = 1;
    uint256 private constant CONFIDENCE_THRESHOLD = 9500;
    
    event PriceUpdated(
        uint32 indexed asset,
        uint256 perpPrice,
        uint256 spotPrice,
        uint256 timestamp
    );
    
    function getPrice(uint32 asset) external returns (AggregatedPrice memory) {
        PriceData memory cached = priceCache[asset];
        
        if (!cached.isValid || block.timestamp > cached.timestamp + CACHE_DURATION) {
            cached = _fetchAndCachePrice(asset);
        }
        
        uint256 avgPrice = (cached.perpPrice + cached.spotPrice) / 2;
        uint256 confidence = _calculateConfidence(cached.perpPrice, cached.spotPrice);
        
        AggregatedPrice memory aggregated = AggregatedPrice({
            price: avgPrice,
            confidence: confidence,
            decimals: 8,
            timestamp: block.timestamp
        });
        
        aggregatedPrices[asset] = aggregated;
        
        return aggregated;
    }
    
    function getBatchPrices(
        uint32[] calldata assets
    ) external returns (AggregatedPrice[] memory) {
        AggregatedPrice[] memory prices = new AggregatedPrice[](assets.length);
        
        for (uint256 i = 0; i < assets.length; i++) {
            prices[i] = this.getPrice(assets[i]);
        }
        
        return prices;
    }
    
    function getPriceWithProof(
        uint32 asset
    ) external view returns (
        AggregatedPrice memory price,
        bytes memory proof
    ) {
        price = aggregatedPrices[asset];
        
        proof = abi.encode(
            PERPS_ORACLE.getPerpsOraclePrice(asset),
            SPOT_ORACLE.getSpotOraclePrice(asset),
            block.timestamp,
            block.number
        );
        
        return (price, proof);
    }
    
    function _fetchAndCachePrice(uint32 asset) private returns (PriceData memory) {
        uint256 perpPrice = PERPS_ORACLE.getPerpsOraclePrice(asset);
        uint256 spotPrice = SPOT_ORACLE.getSpotOraclePrice(asset);
        
        uint256 spread = perpPrice > spotPrice ?
            ((perpPrice - spotPrice) * 10000) / spotPrice :
            ((spotPrice - perpPrice) * 10000) / perpPrice;
        
        PriceData memory data = PriceData({
            perpPrice: perpPrice,
            spotPrice: spotPrice,
            spread: spread,
            timestamp: block.timestamp,
            isValid: true
        });
        
        priceCache[asset] = data;
        
        emit PriceUpdated(asset, perpPrice, spotPrice, block.timestamp);
        
        return data;
    }
    
    function _calculateConfidence(
        uint256 perpPrice,
        uint256 spotPrice
    ) private pure returns (uint256) {
        if (perpPrice == 0 || spotPrice == 0) return 0;
        
        uint256 diff = perpPrice > spotPrice ?
            perpPrice - spotPrice : spotPrice - perpPrice;
        
        uint256 avg = (perpPrice + spotPrice) / 2;
        
        if (diff == 0) return 10000;
        
        uint256 deviation = (diff * 10000) / avg;
        
        if (deviation >= 500) return 5000;
        
        return 10000 - (deviation * 10);
    }
    
    function verifyPriceProof(
        uint32 asset,
        AggregatedPrice memory price,
        bytes memory proof
    ) external view returns (bool) {
        (
            uint256 perpPrice,
            uint256 spotPrice,
            uint256 timestamp,
            uint256 blockNum
        ) = abi.decode(proof, (uint256, uint256, uint256, uint256));
        
        uint256 expectedPrice = (perpPrice + spotPrice) / 2;
        
        return (
            price.price == expectedPrice &&
            price.timestamp == timestamp &&
            blockNum <= block.number &&
            blockNum + 256 > block.number
        );
    }
}