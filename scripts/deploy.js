const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("Deploying HyperCore Advanced Suite...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Deploy TransactionSimulator
  console.log("\n1. Deploying TransactionSimulator...");
  const TransactionSimulator = await ethers.getContractFactory("TransactionSimulator");
  const simulator = await TransactionSimulator.deploy();
  await simulator.deployed();
  console.log("TransactionSimulator deployed to:", simulator.address);

  // Deploy OraclePrecompile
  console.log("\n2. Deploying OraclePrecompile...");
  const OraclePrecompile = await ethers.getContractFactory("OraclePrecompile");
  const oracle = await OraclePrecompile.deploy();
  await oracle.deployed();
  console.log("OraclePrecompile deployed to:", oracle.address);

  // Deploy CoreEVMArbitrage
  console.log("\n3. Deploying CoreEVMArbitrage...");
  const CoreEVMArbitrage = await ethers.getContractFactory("CoreEVMArbitrage");
  const arbitrage = await CoreEVMArbitrage.deploy();
  await arbitrage.deployed();
  console.log("CoreEVMArbitrage deployed to:", arbitrage.address);

  // Deploy ShieldedTWAPExecutor
  console.log("\n4. Deploying ShieldedTWAPExecutor...");
  const ShieldedTWAPExecutor = await ethers.getContractFactory("ShieldedTWAPExecutor");
  const twap = await ShieldedTWAPExecutor.deploy();
  await twap.deployed();
  console.log("ShieldedTWAPExecutor deployed to:", twap.address);

  // Save deployment addresses
  const deployments = {
    network: network.name,
    contracts: {
      TransactionSimulator: simulator.address,
      OraclePrecompile: oracle.address,
      CoreEVMArbitrage: arbitrage.address,
      ShieldedTWAPExecutor: twap.address
    },
    deployer: deployer.address,
    timestamp: new Date().toISOString()
  };

  const deploymentsPath = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsPath)) {
    fs.mkdirSync(deploymentsPath);
  }

  fs.writeFileSync(
    path.join(deploymentsPath, `${network.name}.json`),
    JSON.stringify(deployments, null, 2)
  );

  console.log("\n✅ Deployment complete!");
  console.log("Deployment data saved to:", `deployments/${network.name}.json`);

  // Verify contracts if not on localhost
  if (network.name !== "localhost" && network.name !== "hardhat") {
    console.log("\n📝 Verifying contracts...");
    
    try {
      await hre.run("verify:verify", {
        address: simulator.address,
        constructorArguments: []
      });
      console.log("TransactionSimulator verified");
    } catch (error) {
      console.log("TransactionSimulator verification failed:", error.message);
    }

    try {
      await hre.run("verify:verify", {
        address: oracle.address,
        constructorArguments: []
      });
      console.log("OraclePrecompile verified");
    } catch (error) {
      console.log("OraclePrecompile verification failed:", error.message);
    }

    try {
      await hre.run("verify:verify", {
        address: arbitrage.address,
        constructorArguments: []
      });
      console.log("CoreEVMArbitrage verified");
    } catch (error) {
      console.log("CoreEVMArbitrage verification failed:", error.message);
    }

    try {
      await hre.run("verify:verify", {
        address: twap.address,
        constructorArguments: []
      });
      console.log("ShieldedTWAPExecutor verified");
    } catch (error) {
      console.log("ShieldedTWAPExecutor verification failed:", error.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });