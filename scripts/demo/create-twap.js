const { ethers } = require("hardhat");

async function main() {
    console.log("🚀 Creating Shielded TWAP Order Demo\n");
    
    // Get deployed contract address (update with your deployed address)
    const TWAP_ADDRESS = process.env.TWAP_CONTRACT || "0x...";
    
    // Get signer
    const [signer] = await ethers.getSigners();
    console.log("📝 Executing from account:", signer.address);
    
    // Connect to contract
    const TWAPExecutor = await ethers.getContractFactory("ShieldedTWAPExecutorV2");
    const twap = TWAPExecutor.attach(TWAP_ADDRESS);
    
    // Order parameters
    const orderParams = {
        asset: 1,  // ETH
        totalSize: ethers.parseUnits("10", 8),  // 10 ETH
        sliceSize: ethers.parseUnits("1", 8),   // 1 ETH per slice
        interval: 300,  // 5 minutes between slices
        minPrice: ethers.parseUnits("2000", 8),  // $2000 minimum
        maxPrice: ethers.parseUnits("2500", 8),  // $2500 maximum
        isBuy: true,
        useAdaptiveSlicing: true,  // Enable adaptive sizing
        useBBO: true,  // Use best bid/offer pricing
        secret: ethers.keccak256(ethers.toUtf8Bytes("demo-secret-" + Date.now()))
    };
    
    console.log("📊 Order Parameters:");
    console.log("  Asset: ETH");
    console.log("  Total Size: 10 ETH");
    console.log("  Slice Size: 1 ETH (adaptive)");
    console.log("  Interval: 5 minutes");
    console.log("  Price Range: $2,000 - $2,500");
    console.log("  Adaptive Slicing: ✅ Enabled");
    console.log("  BBO Pricing: ✅ Enabled");
    console.log("");
    
    // Create the order
    console.log("⏳ Creating shielded TWAP order...");
    const tx = await twap.createShieldedTWAP(
        orderParams.asset,
        orderParams.totalSize,
        orderParams.sliceSize,
        orderParams.interval,
        orderParams.minPrice,
        orderParams.maxPrice,
        orderParams.isBuy,
        orderParams.useAdaptiveSlicing,
        orderParams.useBBO,
        orderParams.secret
    );
    
    console.log("📤 Transaction submitted:", tx.hash);
    const receipt = await tx.wait();
    
    // Get order ID from events
    const event = receipt.logs.find(log => {
        try {
            const parsed = twap.interface.parseLog(log);
            return parsed.name === "TWAPOrderCreated";
        } catch {
            return false;
        }
    });
    
    if (event) {
        const parsed = twap.interface.parseLog(event);
        const orderId = parsed.args.orderId;
        
        console.log("\n✅ TWAP Order Created Successfully!");
        console.log("📋 Order ID:", orderId);
        console.log("🔒 Order is shielded and protected from MEV");
        console.log("\n💡 Features Active:");
        console.log("  • Adaptive slice sizing based on volatility");
        console.log("  • BBO pricing from live order book");
        console.log("  • Random execution timing (MEV protection)");
        console.log("  • Commit-reveal privacy scheme");
        console.log("\n🎯 Next Steps:");
        console.log("  1. Monitor execution: npm run demo:monitor");
        console.log("  2. View analytics: npm run demo:analytics");
        
        // Save order ID for other scripts
        require('fs').writeFileSync('.last-order-id', orderId);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Error:", error);
        process.exit(1);
    });