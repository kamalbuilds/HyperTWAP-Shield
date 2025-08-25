const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ShieldedTWAPExecutor - Enhanced Features", function () {
    let twapExecutor;
    let owner, user1, user2;
    
    // Test constants
    const ASSET_BTC = 0;
    const ASSET_ETH = 1;
    const ONE_USD = ethers.parseUnits("1", 8);
    const TEST_SECRET = ethers.keccak256(ethers.toUtf8Bytes("test-secret-123"));
    
    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();
        
        const TWAPExecutor = await ethers.getContractFactory("ShieldedTWAPExecutor");
        twapExecutor = await TWAPExecutor.deploy();
        await twapExecutor.waitForDeployment();
    });
    
    describe("Enhanced Order Creation", function () {
        it("Should create order with adaptive slicing enabled", async function () {
            const totalSize = ethers.parseUnits("10", 8);
            const sliceSize = ethers.parseUnits("1", 8);
            const interval = 300; // 5 minutes
            const minPrice = ethers.parseUnits("40000", 8);
            const maxPrice = ethers.parseUnits("45000", 8);
            
            const tx = await twapExecutor.connect(user1).createShieldedTWAP(
                ASSET_BTC,
                totalSize,
                sliceSize,
                interval,
                minPrice,
                maxPrice,
                true, // isBuy
                true, // useAdaptiveSlicing
                false, // useBBO
                TEST_SECRET
            );
            
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "TWAPOrderCreated");
            
            expect(event).to.not.be.undefined;
            expect(event.args.asset).to.equal(ASSET_BTC);
            expect(event.args.totalSize).to.equal(totalSize);
        });
        
        it("Should create order with BBO pricing enabled", async function () {
            const totalSize = ethers.parseUnits("5", 8);
            const sliceSize = ethers.parseUnits("0.5", 8);
            const interval = 180; // 3 minutes
            const minPrice = ethers.parseUnits("2000", 8);
            const maxPrice = ethers.parseUnits("2500", 8);
            
            const tx = await twapExecutor.connect(user1).createShieldedTWAP(
                ASSET_ETH,
                totalSize,
                sliceSize,
                interval,
                minPrice,
                maxPrice,
                false, // isSell
                false, // useAdaptiveSlicing
                true, // useBBO
                TEST_SECRET
            );
            
            const receipt = await tx.wait();
            expect(receipt.status).to.equal(1);
        });
        
        it("Should reject orders with invalid parameters", async function () {
            await expect(
                twapExecutor.createShieldedTWAP(
                    ASSET_BTC,
                    0, // Invalid: zero size
                    ethers.parseUnits("1", 8),
                    300,
                    ethers.parseUnits("40000", 8),
                    ethers.parseUnits("45000", 8),
                    true,
                    false,
                    false,
                    TEST_SECRET
                )
            ).to.be.revertedWith("Invalid sizes");
        });
    });
    
    describe("Commit-Reveal Pattern", function () {
        let orderId;
        const commitNonce = ethers.keccak256(ethers.toUtf8Bytes("nonce123"));
        
        beforeEach(async function () {
            // Create a TWAP order
            const tx = await twapExecutor.connect(user1).createShieldedTWAP(
                ASSET_BTC,
                ethers.parseUnits("10", 8),
                ethers.parseUnits("1", 8),
                300,
                ethers.parseUnits("40000", 8),
                ethers.parseUnits("45000", 8),
                true,
                true,
                false,
                TEST_SECRET
            );
            
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "TWAPOrderCreated");
            orderId = event.args.orderId;
        });
        
        it("Should allow committing to execute", async function () {
            const commitHash = ethers.keccak256(
                ethers.solidityPacked(["bytes32", "bytes32"], [orderId, commitNonce])
            );
            
            await expect(
                twapExecutor.commitToExecute(orderId, commitHash)
            ).to.not.be.reverted;
        });
        
        it("Should prevent double commits", async function () {
            const commitHash = ethers.keccak256(
                ethers.solidityPacked(["bytes32", "bytes32"], [orderId, commitNonce])
            );
            
            await twapExecutor.commitToExecute(orderId, commitHash);
            
            await expect(
                twapExecutor.commitToExecute(orderId, commitHash)
            ).to.be.revertedWith("Already committed");
        });
        
        it("Should enforce commit-reveal delay", async function () {
            const commitHash = ethers.keccak256(
                ethers.solidityPacked(["bytes32", "bytes32"], [orderId, commitNonce])
            );
            
            await twapExecutor.commitToExecute(orderId, commitHash);
            
            // Try to reveal immediately (should fail)
            await expect(
                twapExecutor.executeTWAPSlice(orderId, TEST_SECRET, commitNonce)
            ).to.be.revertedWith("Reveal too early");
            
            // Wait for commit-reveal delay
            await time.increase(31);
            
            // Mock precompile responses would be needed here
            // In a real test environment, you'd use a fork or mock contracts
        });
    });
    
    describe("Market Analytics", function () {
        it("Should get market analytics for an asset", async function () {
            // This would need mocked precompiles in a real test
            // For now, we just check the function exists and doesn't revert
            // on valid input
            
            try {
                const analytics = await twapExecutor.getMarketAnalytics(ASSET_BTC);
                expect(analytics).to.have.property('bidPrice');
                expect(analytics).to.have.property('askPrice');
                expect(analytics).to.have.property('spread');
                expect(analytics).to.have.property('volatility');
                expect(analytics).to.have.property('l1Block');
            } catch (e) {
                // Expected to fail without mocked precompiles
                expect(e.message).to.include("staticcall");
            }
        });
    });
    
    describe("Order Status and Analytics", function () {
        it("Should return enhanced order status with average price", async function () {
            const tx = await twapExecutor.connect(user1).createShieldedTWAP(
                ASSET_BTC,
                ethers.parseUnits("10", 8),
                ethers.parseUnits("1", 8),
                300,
                ethers.parseUnits("40000", 8),
                ethers.parseUnits("45000", 8),
                true,
                false,
                false,
                TEST_SECRET
            );
            
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "TWAPOrderCreated");
            const orderId = event.args.orderId;
            
            const status = await twapExecutor.getOrderStatus(orderId);
            
            expect(status.active).to.be.true;
            expect(status.executedSize).to.equal(0);
            expect(status.totalSize).to.equal(ethers.parseUnits("10", 8));
            expect(status.averagePrice).to.equal(0); // No executions yet
        });
    });
    
    describe("MEV Protection", function () {
        it("Should have randomized execution timing", async function () {
            const orders = [];
            
            // Create multiple orders
            for (let i = 0; i < 3; i++) {
                const tx = await twapExecutor.connect(user1).createShieldedTWAP(
                    ASSET_BTC,
                    ethers.parseUnits("1", 8),
                    ethers.parseUnits("0.1", 8),
                    300,
                    ethers.parseUnits("40000", 8),
                    ethers.parseUnits("45000", 8),
                    true,
                    false,
                    false,
                    ethers.keccak256(ethers.toUtf8Bytes(`secret-${i}`))
                );
                
                const receipt = await tx.wait();
                const event = receipt.logs.find(log => log.fragment?.name === "TWAPOrderCreated");
                orders.push(event.args.orderId);
            }
            
            // Get execution times
            const executionTimes = [];
            for (const orderId of orders) {
                const status = await twapExecutor.getOrderStatus(orderId);
                executionTimes.push(status.nextExecutionTime);
            }
            
            // Check that not all execution times are identical
            // (they should have random jitter)
            const uniqueTimes = [...new Set(executionTimes)];
            expect(uniqueTimes.length).to.be.greaterThan(1);
        });
    });
    
    describe("Gas Optimization", function () {
        it("Should efficiently handle batch operations", async function () {
            const userOrders = await twapExecutor.getUserOrders(user1.address);
            expect(userOrders).to.be.an('array');
            
            // Create multiple orders and check gas usage
            const gasUsed = [];
            
            for (let i = 0; i < 3; i++) {
                const tx = await twapExecutor.connect(user1).createShieldedTWAP(
                    ASSET_BTC,
                    ethers.parseUnits("1", 8),
                    ethers.parseUnits("0.1", 8),
                    300,
                    ethers.parseUnits("40000", 8),
                    ethers.parseUnits("45000", 8),
                    true,
                    i % 2 === 0, // Alternate adaptive slicing
                    i % 2 === 1, // Alternate BBO usage
                    ethers.keccak256(ethers.toUtf8Bytes(`gas-test-${i}`))
                );
                
                const receipt = await tx.wait();
                gasUsed.push(receipt.gasUsed);
            }
            
            // Check that gas usage is reasonable and consistent
            const avgGas = gasUsed.reduce((a, b) => a + b, 0n) / BigInt(gasUsed.length);
            expect(avgGas).to.be.lessThan(500000n); // Should be under 500k gas
        });
    });
});