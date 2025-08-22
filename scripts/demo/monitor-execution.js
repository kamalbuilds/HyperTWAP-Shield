const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
    console.log("📊 Monitoring TWAP Execution\n");
    
    // Get contract and order ID
    const TWAP_ADDRESS = process.env.TWAP_CONTRACT || "0x...";
    const orderId = fs.readFileSync('.last-order-id', 'utf8').trim();
    
    const TWAPExecutor = await ethers.getContractFactory("ShieldedTWAPExecutorV2");
    const twap = TWAPExecutor.attach(TWAP_ADDRESS);
    
    console.log("🔍 Monitoring Order:", orderId);
    console.log("⏱️  Updates every 10 seconds\n");
    
    let lastExecutedSize = 0;
    let executionCount = 0;
    
    const monitor = async () => {
        try {
            // Get order status
            const status = await twap.getOrderStatus(orderId);
            const [active, executedSize, totalSize, nextExecutionTime, averagePrice, remainingSlices] = status;
            
            // Get market analytics
            const analytics = await twap.getMarketAnalytics(1); // ETH
            const [bidPrice, askPrice, spread, volatility, l1Block] = analytics;
            
            // Clear console and display status
            console.clear();
            console.log("📊 TWAP EXECUTION MONITOR");
            console.log("=" .repeat(50));
            
            // Order Progress
            const progress = (Number(executedSize) / Number(totalSize) * 100).toFixed(2);
            const progressBar = "█".repeat(Math.floor(progress / 5)) + "░".repeat(20 - Math.floor(progress / 5));
            console.log(`\n📈 Order Progress: [${progressBar}] ${progress}%`);
            console.log(`   Executed: ${ethers.formatUnits(executedSize, 8)} / ${ethers.formatUnits(totalSize, 8)} ETH`);
            console.log(`   Remaining Slices: ${remainingSlices}`);
            console.log(`   Average Price: $${ethers.formatUnits(averagePrice, 8)}`);
            
            // Market Conditions
            console.log("\n🌐 Market Conditions:");
            console.log(`   Bid: $${ethers.formatUnits(bidPrice, 8)}`);
            console.log(`   Ask: $${ethers.formatUnits(askPrice, 8)}`);
            console.log(`   Spread: ${ethers.formatUnits(spread, 8)} (${(Number(spread) / Number(askPrice) * 10000).toFixed(2)} bps)`);
            console.log(`   Volatility: ${(Number(volatility) / 100).toFixed(2)}%`);
            console.log(`   L1 Block: ${l1Block}`);
            
            // Adaptive Behavior
            console.log("\n🎯 Adaptive Execution:");
            if (volatility > 500) {
                console.log("   ⚠️  HIGH VOLATILITY - Slice size reduced by 25%");
            } else if (volatility < 100) {
                console.log("   ✅ LOW VOLATILITY - Slice size increased by 50%");
            } else {
                console.log("   ➡️  NORMAL CONDITIONS - Standard slice size");
            }
            
            // Check for new execution
            if (executedSize > lastExecutedSize) {
                const sliceSize = executedSize - lastExecutedSize;
                executionCount++;
                
                console.log("\n🎉 NEW EXECUTION DETECTED!");
                console.log(`   Slice #${executionCount}`);
                console.log(`   Size: ${ethers.formatUnits(sliceSize, 8)} ETH`);
                console.log(`   Price: $${ethers.formatUnits(askPrice, 8)}`);
                console.log(`   Timestamp: ${new Date().toISOString()}`);
                
                lastExecutedSize = executedSize;
            }
            
            // Next execution
            if (active) {
                const nextExec = new Date(Number(nextExecutionTime) * 1000);
                const timeUntil = Math.max(0, (nextExec - Date.now()) / 1000);
                console.log(`\n⏰ Next Execution: ${nextExec.toLocaleTimeString()}`);
                console.log(`   Time Until: ${Math.floor(timeUntil / 60)}m ${Math.floor(timeUntil % 60)}s`);
            } else if (executedSize >= totalSize) {
                console.log("\n✅ ORDER COMPLETE!");
                console.log(`   Total Slices: ${executionCount}`);
                console.log(`   Average Price: $${ethers.formatUnits(averagePrice, 8)}`);
                process.exit(0);
            }
            
            console.log("\n" + "=".repeat(50));
            console.log("Press Ctrl+C to stop monitoring");
            
        } catch (error) {
            console.log("⚠️  Error reading status:", error.message);
        }
    };
    
    // Initial check
    await monitor();
    
    // Set up monitoring interval
    setInterval(monitor, 10000); // Update every 10 seconds
}

main().catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
});