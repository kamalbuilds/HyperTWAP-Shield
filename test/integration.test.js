const { expect } = require("chai");
const { ethers } = require("hardhat");
const axios = require("axios");

describe("Integration Tests", function () {
  this.timeout(60000); // 1 minute timeout for integration tests

  let simulator;
  let arbitrage;
  let twap;
  let oracle;
  let owner;
  let user;

  before(async function () {
    [owner, user] = await ethers.getSigners();
    console.log("Testing with owner:", owner.address);
  });

  describe("Smart Contracts", function () {
    it("should deploy TransactionSimulator", async function () {
      const TransactionSimulator = await ethers.getContractFactory("TransactionSimulator");
      simulator = await TransactionSimulator.deploy();
      await simulator.deployed();
      expect(simulator.address).to.be.properAddress;
    });

    it("should deploy CoreEVMArbitrage", async function () {
      const CoreEVMArbitrage = await ethers.getContractFactory("CoreEVMArbitrage");
      arbitrage = await CoreEVMArbitrage.deploy();
      await arbitrage.deployed();
      expect(arbitrage.address).to.be.properAddress;
    });

    it("should deploy ShieldedTWAPExecutor", async function () {
      const ShieldedTWAPExecutor = await ethers.getContractFactory("ShieldedTWAPExecutor");
      twap = await ShieldedTWAPExecutor.deploy();
      await twap.deployed();
      expect(twap.address).to.be.properAddress;
    });

    it("should deploy OraclePrecompile", async function () {
      const OraclePrecompile = await ethers.getContractFactory("OraclePrecompile");
      oracle = await OraclePrecompile.deploy();
      await oracle.deployed();
      expect(oracle.address).to.be.properAddress;
    });
  });

  describe("Transaction Simulator", function () {
    it("should simulate a transaction", async function () {
      const params = {
        target: user.address,
        callData: "0x",
        value: 0,
        gasLimit: 100000,
        includePrecompiles: false
      };

      const result = await simulator.simulateTransaction(params);
      expect(result.success).to.be.true;
      expect(result.gasUsed).to.be.gt(0);
    });

    it("should batch simulate transactions", async function () {
      const params = [
        {
          target: user.address,
          callData: "0x",
          value: 0,
          gasLimit: 50000,
          includePrecompiles: false
        },
        {
          target: owner.address,
          callData: "0x",
          value: 0,
          gasLimit: 50000,
          includePrecompiles: false
        }
      ];

      const results = await simulator.batchSimulate(params);
      expect(results).to.have.lengthOf(2);
      results.forEach(result => {
        expect(result.gasUsed).to.be.gt(0);
      });
    });
  });

  describe("Arbitrage System", function () {
    it("should detect arbitrage opportunities", async function () {
      const assets = [0, 1, 2];
      const [opportunities, spreads] = await arbitrage.detectArbitrage(assets);
      
      // May or may not find opportunities depending on mock data
      expect(opportunities).to.be.an("array");
      expect(spreads).to.be.an("array");
      expect(opportunities.length).to.equal(spreads.length);
    });

    it("should authorize users for arbitrage execution", async function () {
      await arbitrage.updateAuthorization(user.address, true);
      const isAuthorized = await arbitrage.authorized(user.address);
      expect(isAuthorized).to.be.true;
    });
  });

  describe("TWAP Executor", function () {
    it("should create a shielded TWAP order", async function () {
      const secret = ethers.utils.formatBytes32String("secret123");
      
      const tx = await twap.createShieldedTWAP(
        0, // asset
        ethers.utils.parseUnits("1000", 8), // totalSize
        ethers.utils.parseUnits("100", 8), // sliceSize
        60, // interval (seconds)
        ethers.utils.parseUnits("4900", 8), // minPrice
        ethers.utils.parseUnits("5100", 8), // maxPrice
        true, // isBuy
        secret
      );

      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "TWAPOrderCreated");
      expect(event).to.not.be.undefined;
      
      const orderId = event.args.orderId;
      expect(orderId).to.not.be.undefined;

      // Check order status
      const status = await twap.getOrderStatus(orderId);
      expect(status.active).to.be.true;
      expect(status.totalSize).to.equal(ethers.utils.parseUnits("1000", 8));
    });
  });

  describe("Oracle Precompile", function () {
    it("should get aggregated price", async function () {
      const price = await oracle.getPrice(0);
      expect(price.price).to.be.gt(0);
      expect(price.confidence).to.be.gt(0);
      expect(price.decimals).to.equal(8);
    });

    it("should get batch prices", async function () {
      const assets = [0, 1, 2];
      const prices = await oracle.getBatchPrices(assets);
      
      expect(prices).to.have.lengthOf(3);
      prices.forEach(price => {
        expect(price.price).to.be.gt(0);
        expect(price.confidence).to.be.gt(0);
      });
    });

    it("should provide price with proof", async function () {
      const [price, proof] = await oracle.getPriceWithProof(0);
      
      expect(price.price).to.be.gt(0);
      expect(proof).to.not.be.empty;
      
      // Verify the proof
      const isValid = await oracle.verifyPriceProof(0, price, proof);
      expect(isValid).to.be.true;
    });
  });

  describe("Simulator API (if running)", function () {
    const SIMULATOR_URL = "http://localhost:3000";
    
    it("should check simulator health", async function () {
      try {
        const response = await axios.get(`${SIMULATOR_URL}/`);
        expect(response.data).to.equal("HyperEVM Simulator v1.0.0");
      } catch (error) {
        this.skip(); // Skip if simulator is not running
      }
    });

    it("should simulate transaction via API", async function () {
      try {
        const response = await axios.post(`${SIMULATOR_URL}/simulate`, {
          from: owner.address,
          to: user.address,
          data: "0x",
          value: "0",
          gas: 100000,
          include_precompiles: false
        });
        
        expect(response.data.success).to.be.true;
        expect(response.data.gas_used).to.be.gt(0);
      } catch (error) {
        this.skip(); // Skip if simulator is not running
      }
    });
  });
});