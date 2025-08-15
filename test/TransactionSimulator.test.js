const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TransactionSimulator", function () {
  let simulator;
  let owner;
  let user;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    
    const TransactionSimulator = await ethers.getContractFactory("TransactionSimulator");
    simulator = await TransactionSimulator.deploy();
    await simulator.deployed();
  });

  describe("simulateTransaction", function () {
    it("should simulate a simple transaction", async function () {
      const params = {
        target: user.address,
        callData: "0x",
        value: ethers.utils.parseEther("1"),
        gasLimit: 100000,
        includePrecompiles: false
      };

      const result = await simulator.simulateTransaction(params);
      
      expect(result.gasUsed).to.be.gt(0);
      expect(result.gasUsed).to.be.lt(params.gasLimit);
    });

    it("should simulate CoreWriter action", async function () {
      const coreWriterAddress = "0x3333333333333333333333333333333333333333";
      
      const limitOrderData = ethers.utils.defaultAbiCoder.encode(
        ["uint32", "bool", "uint64", "uint64", "bool", "uint8", "uint128"],
        [0, true, ethers.utils.parseUnits("5000", 8), ethers.utils.parseUnits("1", 8), false, 2, 0]
      );
      
      const actionData = ethers.utils.concat([
        "0x01",
        "0x000001",
        limitOrderData
      ]);
      
      const params = {
        target: coreWriterAddress,
        callData: actionData,
        value: 0,
        gasLimit: 100000,
        includePrecompiles: true
      };

      const result = await simulator.simulateTransaction(params);
      
      expect(result.success).to.be.true;
      expect(result.returnData).to.include("Limit order simulation");
    });

    it("should handle batch simulations", async function () {
      const params1 = {
        target: user.address,
        callData: "0x",
        value: 0,
        gasLimit: 50000,
        includePrecompiles: false
      };
      
      const params2 = {
        target: owner.address,
        callData: "0x",
        value: 0,
        gasLimit: 50000,
        includePrecompiles: false
      };

      const results = await simulator.batchSimulate([params1, params2]);
      
      expect(results).to.have.lengthOf(2);
      expect(results[0].gasUsed).to.be.gt(0);
      expect(results[1].gasUsed).to.be.gt(0);
    });

    it("should cache simulation results", async function () {
      const params = {
        target: user.address,
        callData: "0x",
        value: 0,
        gasLimit: 50000,
        includePrecompiles: false
      };

      const result1 = await simulator.simulateTransaction(params);
      const gasUsed1 = await ethers.provider.getTransactionReceipt(result1.hash)
        .then(r => r.gasUsed);
      
      const result2 = await simulator.simulateTransaction(params);
      const gasUsed2 = await ethers.provider.getTransactionReceipt(result2.hash)
        .then(r => r.gasUsed);
      
      expect(gasUsed2).to.be.lt(gasUsed1);
    });
  });

  describe("clearCache", function () {
    it("should clear the simulation cache", async function () {
      await simulator.clearCache();
    });
  });
});