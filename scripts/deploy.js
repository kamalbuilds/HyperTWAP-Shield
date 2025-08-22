const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Deploying HyperCore Advanced Suite to Hyperliquid Testnet...\n");
  console.log("=" .repeat(60));

  const [deployer] = await ethers.getSigners();
  console.log("📝 Deploying with account:", deployer.address);
  
  // Get balance using ethers v6 syntax
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "ETH");
  
  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log("🌐 Network: Hyperliquid Testnet");
  console.log("🔗 Chain ID:", network.chainId.toString());
  console.log("🔗 RPC URL: https://rpc.hyperliquid-testnet.xyz/evm\n");
  console.log("=" .repeat(60));

  const deployedContracts = {};

  // Deploy TransactionSimulator
  console.log("\n1️⃣  Deploying TransactionSimulator...");
  try {
    const TransactionSimulator = await ethers.getContractFactory("TransactionSimulator");
    const simulator = await TransactionSimulator.deploy();
    await simulator.waitForDeployment();
    deployedContracts.TransactionSimulator = await simulator.getAddress();
    console.log("   ✅ TransactionSimulator deployed to:", deployedContracts.TransactionSimulator);
    console.log("   📊 Tx hash:", simulator.deploymentTransaction().hash);
  } catch (error) {
    console.log("   ❌ TransactionSimulator deployment failed:", error.message);
  }

  // Deploy OraclePrecompile
  console.log("\n2️⃣  Deploying OraclePrecompile...");
  try {
    const OraclePrecompile = await ethers.getContractFactory("OraclePrecompile");
    const oracle = await OraclePrecompile.deploy();
    await oracle.waitForDeployment();
    deployedContracts.OraclePrecompile = await oracle.getAddress();
    console.log("   ✅ OraclePrecompile deployed to:", deployedContracts.OraclePrecompile);
    console.log("   📊 Tx hash:", oracle.deploymentTransaction().hash);
  } catch (error) {
    console.log("   ❌ OraclePrecompile deployment failed:", error.message);
  }

  // Deploy CoreEVMArbitrage
  console.log("\n3️⃣  Deploying CoreEVMArbitrage...");
  try {
    const CoreEVMArbitrage = await ethers.getContractFactory("CoreEVMArbitrage");
    const arbitrage = await CoreEVMArbitrage.deploy();
    await arbitrage.waitForDeployment();
    deployedContracts.CoreEVMArbitrage = await arbitrage.getAddress();
    console.log("   ✅ CoreEVMArbitrage deployed to:", deployedContracts.CoreEVMArbitrage);
    console.log("   📊 Tx hash:", arbitrage.deploymentTransaction().hash);
  } catch (error) {
    console.log("   ❌ CoreEVMArbitrage deployment failed:", error.message);
  }

  // Deploy ShieldedTWAPExecutor
  console.log("\n4️⃣  Deploying ShieldedTWAPExecutor...");
  try {
    const ShieldedTWAPExecutor = await ethers.getContractFactory("ShieldedTWAPExecutor");
    const twap = await ShieldedTWAPExecutor.deploy();
    await twap.waitForDeployment();
    deployedContracts.ShieldedTWAPExecutor = await twap.getAddress();
    console.log("   ✅ ShieldedTWAPExecutor deployed to:", deployedContracts.ShieldedTWAPExecutor);
    console.log("   📊 Tx hash:", twap.deploymentTransaction().hash);
  } catch (error) {
    console.log("   ❌ ShieldedTWAPExecutor deployment failed:", error.message);
  }

  // Deploy ShieldedTWAPExecutorV2
  console.log("\n5️⃣  Deploying ShieldedTWAPExecutorV2...");
  try {
    const ShieldedTWAPExecutorV2 = await ethers.getContractFactory("ShieldedTWAPExecutorV2");
    const twapV2 = await ShieldedTWAPExecutorV2.deploy();
    await twapV2.waitForDeployment();
    deployedContracts.ShieldedTWAPExecutorV2 = await twapV2.getAddress();
    console.log("   ✅ ShieldedTWAPExecutorV2 deployed to:", deployedContracts.ShieldedTWAPExecutorV2);
    console.log("   📊 Tx hash:", twapV2.deploymentTransaction().hash);
  } catch (error) {
    console.log("   ❌ ShieldedTWAPExecutorV2 deployment failed:", error.message);
  }

  // Save deployment addresses
  const deployments = {
    network: "hyperliquid-testnet",
    chainId: network.chainId.toString(),
    contracts: deployedContracts,
    precompiles: {
      L1_BLOCK_NUMBER: "0x0000000000000000000000000000000000000809",
      PERPS_ORACLE: "0x0000000000000000000000000000000000000807",
      SPOT_ORACLE: "0x0000000000000000000000000000000000000808",
      BBO_PRECOMPILE: "0x000000000000000000000000000000000000080e",
      ACCOUNT_MARGIN: "0x000000000000000000000000000000000000080f",
      SPOT_BALANCE: "0x0000000000000000000000000000000000000801",
      CORE_WRITER: "0x3333333333333333333333333333333333333333"
    },
    deployer: deployer.address,
    timestamp: new Date().toISOString()
  };

  const deploymentsPath = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsPath)) {
    fs.mkdirSync(deploymentsPath);
  }

  fs.writeFileSync(
    path.join(deploymentsPath, "hyperliquid-testnet.json"),
    JSON.stringify(deployments, null, 2)
  );

  // Also save to root directory for easy access
  fs.writeFileSync(
    path.join(__dirname, "../deployment-info.json"),
    JSON.stringify(deployments, null, 2)
  );

  console.log("\n" + "=" .repeat(60));
  console.log("✅ DEPLOYMENT COMPLETE!");
  console.log("=" .repeat(60));
  
  console.log("\n📋 Deployed Contracts:");
  Object.entries(deployedContracts).forEach(([name, address]) => {
    console.log(`   ${name}: ${address}`);
  });

  console.log("\n🔍 View on Explorer:");
  Object.entries(deployedContracts).forEach(([name, address]) => {
    console.log(`   ${name}: https://explorer.hyperliquid-testnet.xyz/address/${address}`);
  });

  console.log("\n📁 Deployment data saved to:");
  console.log("   - deployments/hyperliquid-testnet.json");
  console.log("   - deployment-info.json");

  // Update .env file
  if (deployedContracts.ShieldedTWAPExecutorV2) {
    console.log("\n🎯 Next Steps:");
    console.log(`   1. Export: export TWAP_CONTRACT=${deployedContracts.ShieldedTWAPExecutorV2}`);
    console.log("   2. Create order: npm run demo:create");
    console.log("   3. Monitor: npm run demo:monitor");
    console.log("   4. Analytics: npm run demo:analytics");
  }

  console.log("\n" + "=" .repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed!");
    console.error(error);
    process.exit(1);
  });