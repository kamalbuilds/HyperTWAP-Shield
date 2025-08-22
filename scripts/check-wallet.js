const { ethers } = require("ethers");

async function main() {
    const privateKey = "0x923f625563505ea324659d273fe88c1c4b4f25ef377fcbad1bcc64b0b5a298f8";
    const wallet = new ethers.Wallet(privateKey);
    
    console.log("🔑 Wallet Details:");
    console.log("   Address:", wallet.address);
    console.log("   Private Key:", privateKey);
    
    // Connect to Hyperliquid testnet
    const provider = new ethers.JsonRpcProvider("https://rpc.hyperliquid-testnet.xyz/evm");
    const connectedWallet = wallet.connect(provider);
    
    // Check balance
    const balance = await provider.getBalance(wallet.address);
    console.log("   Balance:", ethers.formatEther(balance), "ETH");
    
    if (balance === 0n) {
        console.log("\n⚠️  WARNING: This wallet has no ETH!");
        console.log("\n📝 To deploy contracts, you need to:");
        console.log("   1. Get testnet ETH from Hyperliquid faucet");
        console.log("   2. Send ETH to:", wallet.address);
        console.log("   3. Or use a different wallet with funds");
    } else {
        console.log("\n✅ Wallet has sufficient funds for deployment!");
    }
}

main().catch(console.error);