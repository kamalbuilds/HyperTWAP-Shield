const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("ShieldedTWAPExecutor", function () {
    let shieldedTWAP;
    let owner;
    let user1;
    let user2;
    let mockCoreWriter;
    let mockOracle;

    const TEST_ASSET = 1;
    const TEST_TOTAL_SIZE = ethers.parseUnits("100", 6);
    const TEST_SLICE_SIZE = ethers.parseUnits("10", 6);
    const TEST_INTERVAL = 300; // 5 minutes
    const TEST_MIN_PRICE = ethers.parseUnits("50000", 6);
    const TEST_MAX_PRICE = ethers.parseUnits("60000", 6);
    const TEST_SECRET = ethers.keccak256(ethers.toUtf8Bytes("secret123"));

    async function deployShieldedTWAPExecutorFixture() {
        const [owner, user1, user2] = await ethers.getSigners();

        // Deploy mock contracts
        const MockCoreWriter = await ethers.getContractFactory("MockCoreWriter");
        mockCoreWriter = await MockCoreWriter.deploy();

        const MockOracle = await ethers.getContractFactory("MockPerpsOracle");
        mockOracle = await MockOracle.deploy();

        // Deploy ShieldedTWAPExecutor
        const ShieldedTWAPExecutor = await ethers.getContractFactory("ShieldedTWAPExecutor");
        shieldedTWAP = await ShieldedTWAPExecutor.deploy();

        return { shieldedTWAP, owner, user1, user2, mockCoreWriter, mockOracle };
    }

    beforeEach(async function () {
        ({ shieldedTWAP, owner, user1, user2, mockCoreWriter, mockOracle } = 
            await loadFixture(deployShieldedTWAPExecutorFixture));
    });

    describe("Order Creation", function () {
        it("Should create a shielded TWAP order successfully", async function () {
            const tx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                TEST_ASSET,
                TEST_TOTAL_SIZE,
                TEST_SLICE_SIZE,
                TEST_INTERVAL,
                TEST_MIN_PRICE,
                TEST_MAX_PRICE,
                true, // isBuy
                TEST_SECRET
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => 
                log.fragment && log.fragment.name === "TWAPOrderCreated"
            );

            expect(event).to.not.be.undefined;
            expect(event.args.owner).to.equal(user1.address);
            expect(event.args.asset).to.equal(TEST_ASSET);
            expect(event.args.totalSize).to.equal(TEST_TOTAL_SIZE);

            // Verify order ID is returned
            const orderId = await shieldedTWAP.createShieldedTWAP.staticCall(
                TEST_ASSET,
                TEST_TOTAL_SIZE,
                TEST_SLICE_SIZE,
                TEST_INTERVAL,
                TEST_MIN_PRICE,
                TEST_MAX_PRICE,
                true,
                TEST_SECRET
            );
            expect(orderId).to.not.equal(ethers.ZeroHash);
        });

        it("Should reject invalid order parameters", async function () {
            // Zero total size
            await expect(
                shieldedTWAP.connect(user1).createShieldedTWAP(
                    TEST_ASSET,
                    0,
                    TEST_SLICE_SIZE,
                    TEST_INTERVAL,
                    TEST_MIN_PRICE,
                    TEST_MAX_PRICE,
                    true,
                    TEST_SECRET
                )
            ).to.be.revertedWith("Invalid sizes");

            // Slice size larger than total
            await expect(
                shieldedTWAP.connect(user1).createShieldedTWAP(
                    TEST_ASSET,
                    TEST_SLICE_SIZE,
                    TEST_TOTAL_SIZE,
                    TEST_INTERVAL,
                    TEST_MIN_PRICE,
                    TEST_MAX_PRICE,
                    true,
                    TEST_SECRET
                )
            ).to.be.revertedWith("Slice too large");

            // Interval too short
            await expect(
                shieldedTWAP.connect(user1).createShieldedTWAP(
                    TEST_ASSET,
                    TEST_TOTAL_SIZE,
                    TEST_SLICE_SIZE,
                    30, // Less than MIN_INTERVAL (60)
                    TEST_MIN_PRICE,
                    TEST_MAX_PRICE,
                    true,
                    TEST_SECRET
                )
            ).to.be.revertedWith("Interval too short");

            // Too many slices
            await expect(
                shieldedTWAP.connect(user1).createShieldedTWAP(
                    TEST_ASSET,
                    ethers.parseUnits("1000", 6), // 1000 units
                    ethers.parseUnits("1", 6), // 1 unit slice = 1000 slices > MAX_SLICES (100)
                    TEST_INTERVAL,
                    TEST_MIN_PRICE,
                    TEST_MAX_PRICE,
                    true,
                    TEST_SECRET
                )
            ).to.be.revertedWith("Too many slices");
        });

        it("Should generate unique order IDs for different orders", async function () {
            const orderId1 = await shieldedTWAP.connect(user1).createShieldedTWAP.staticCall(
                TEST_ASSET,
                TEST_TOTAL_SIZE,
                TEST_SLICE_SIZE,
                TEST_INTERVAL,
                TEST_MIN_PRICE,
                TEST_MAX_PRICE,
                true,
                TEST_SECRET
            );

            const orderId2 = await shieldedTWAP.connect(user1).createShieldedTWAP.staticCall(
                TEST_ASSET + 1, // Different asset
                TEST_TOTAL_SIZE,
                TEST_SLICE_SIZE,
                TEST_INTERVAL,
                TEST_MIN_PRICE,
                TEST_MAX_PRICE,
                true,
                TEST_SECRET
            );

            expect(orderId1).to.not.equal(orderId2);
        });

        it("Should add order to user's order list", async function () {
            await shieldedTWAP.connect(user1).createShieldedTWAP(
                TEST_ASSET,
                TEST_TOTAL_SIZE,
                TEST_SLICE_SIZE,
                TEST_INTERVAL,
                TEST_MIN_PRICE,
                TEST_MAX_PRICE,
                true,
                TEST_SECRET
            );

            const userOrders = await shieldedTWAP.getUserOrders(user1.address);
            expect(userOrders.length).to.equal(1);
        });
    });

    describe("Order Execution", function () {
        let orderId;

        beforeEach(async function () {
            const tx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                TEST_ASSET,
                TEST_TOTAL_SIZE,
                TEST_SLICE_SIZE,
                TEST_INTERVAL,
                TEST_MIN_PRICE,
                TEST_MAX_PRICE,
                true,
                TEST_SECRET
            );
            const receipt = await tx.wait();
            orderId = receipt.logs[0].args.orderId;

            // Mock oracle price within range
            await mockOracle.setPrice(TEST_ASSET, ethers.parseUnits("55000", 6));
        });

        it("Should execute TWAP slice successfully", async function () {
            const result = await shieldedTWAP.executeTWAPSlice.staticCall(orderId, TEST_SECRET);
            
            expect(result.success).to.be.true;
            expect(result.executedAmount).to.equal(TEST_SLICE_SIZE);
            expect(result.averagePrice).to.be.gt(0);
            expect(result.gasUsed).to.be.gt(0);

            // Execute actual transaction
            const tx = await shieldedTWAP.executeTWAPSlice(orderId, TEST_SECRET);
            const receipt = await tx.wait();

            // Verify slice executed event
            const event = receipt.logs.find(log => 
                log.fragment && log.fragment.name === "TWAPSliceExecuted"
            );
            expect(event).to.not.be.undefined;
            expect(event.args.orderId).to.equal(orderId);
            expect(event.args.executedSize).to.equal(TEST_SLICE_SIZE);
        });

        it("Should reject execution with invalid secret", async function () {
            const wrongSecret = ethers.keccak256(ethers.toUtf8Bytes("wrong"));
            
            await expect(
                shieldedTWAP.executeTWAPSlice(orderId, wrongSecret)
            ).to.be.revertedWith("Invalid secret");
        });

        it("Should reject execution when price is out of range", async function () {
            // Set price below minimum
            await mockOracle.setPrice(TEST_ASSET, ethers.parseUnits("40000", 6));
            
            await expect(
                shieldedTWAP.executeTWAPSlice(orderId, TEST_SECRET)
            ).to.be.revertedWith("Price out of range");

            // Set price above maximum
            await mockOracle.setPrice(TEST_ASSET, ethers.parseUnits("70000", 6));
            
            await expect(
                shieldedTWAP.executeTWAPSlice(orderId, TEST_SECRET)
            ).to.be.revertedWith("Price out of range");
        });

        it("Should handle partial execution on final slice", async function () {
            // Create small order that will be partially filled on last slice
            const smallTotal = ethers.parseUnits("25", 6); // 2.5 slices
            const smallOrderTx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                TEST_ASSET,
                smallTotal,
                TEST_SLICE_SIZE,
                TEST_INTERVAL,
                TEST_MIN_PRICE,
                TEST_MAX_PRICE,
                true,
                ethers.keccak256(ethers.toUtf8Bytes("small"))
            );
            const smallOrderId = (await smallOrderTx.wait()).logs[0].args.orderId;

            // Execute first slice
            await shieldedTWAP.executeTWAPSlice(smallOrderId, ethers.keccak256(ethers.toUtf8Bytes("small")));
            
            // Skip time for next execution
            await ethers.provider.send("evm_increaseTime", [TEST_INTERVAL]);
            await ethers.provider.send("evm_mine");

            // Execute partial second slice
            const result = await shieldedTWAP.executeTWAPSlice.staticCall(
                smallOrderId, 
                ethers.keccak256(ethers.toUtf8Bytes("small"))
            );
            
            expect(result.executedAmount).to.equal(ethers.parseUnits("5", 6)); // Remaining 5 units
        });
    });

    describe("Order Status and Queries", function () {
        let orderId;

        beforeEach(async function () {
            const tx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                TEST_ASSET,
                TEST_TOTAL_SIZE,
                TEST_SLICE_SIZE,
                TEST_INTERVAL,
                TEST_MIN_PRICE,
                TEST_MAX_PRICE,
                true,
                TEST_SECRET
            );
            orderId = (await tx.wait()).logs[0].args.orderId;
        });

        it("Should return correct order status", async function () {
            const [active, executedSize, totalSize, nextExecutionTime] = 
                await shieldedTWAP.getOrderStatus(orderId);

            expect(active).to.be.true;
            expect(executedSize).to.equal(0);
            expect(totalSize).to.equal(TEST_TOTAL_SIZE);
            expect(nextExecutionTime).to.be.gt(0);
        });

        it("Should return user orders correctly", async function () {
            // Create another order
            await shieldedTWAP.connect(user1).createShieldedTWAP(
                TEST_ASSET + 1,
                TEST_TOTAL_SIZE,
                TEST_SLICE_SIZE,
                TEST_INTERVAL,
                TEST_MIN_PRICE,
                TEST_MAX_PRICE,
                false,
                ethers.keccak256(ethers.toUtf8Bytes("secret2"))
            );

            const userOrders = await shieldedTWAP.getUserOrders(user1.address);
            expect(userOrders.length).to.equal(2);
            
            // Different user should have no orders
            const user2Orders = await shieldedTWAP.getUserOrders(user2.address);
            expect(user2Orders.length).to.equal(0);
        });
    });

    describe("Order Cancellation", function () {
        let orderId;

        beforeEach(async function () {
            const tx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                TEST_ASSET,
                TEST_TOTAL_SIZE,
                TEST_SLICE_SIZE,
                TEST_INTERVAL,
                TEST_MIN_PRICE,
                TEST_MAX_PRICE,
                true,
                TEST_SECRET
            );
            orderId = (await tx.wait()).logs[0].args.orderId;
        });

        it("Should allow order owner to cancel order", async function () {
            await shieldedTWAP.connect(user1).cancelTWAPOrder(orderId);

            const [active] = await shieldedTWAP.getOrderStatus(orderId);
            expect(active).to.be.false;
        });

        it("Should reject cancellation from non-owner", async function () {
            await expect(
                shieldedTWAP.connect(user2).cancelTWAPOrder(orderId)
            ).to.be.revertedWith("Not order owner");
        });

        it("Should reject cancellation of already inactive order", async function () {
            await shieldedTWAP.connect(user1).cancelTWAPOrder(orderId);
            
            await expect(
                shieldedTWAP.connect(user1).cancelTWAPOrder(orderId)
            ).to.be.revertedWith("Order not active");
        });

        it("Should send cancel action to CoreWriter for partially executed orders", async function () {
            // Mock oracle and execute one slice first
            await mockOracle.setPrice(TEST_ASSET, ethers.parseUnits("55000", 6));
            await shieldedTWAP.executeTWAPSlice(orderId, TEST_SECRET);

            // Cancel should trigger CoreWriter.sendRawAction for cancel
            await expect(shieldedTWAP.connect(user1).cancelTWAPOrder(orderId))
                .to.emit(mockCoreWriter, "ActionSent");
        });
    });

    describe("Order Completion", function () {
        let smallOrderId;

        beforeEach(async function () {
            // Create order that completes in 2 slices
            const tx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                TEST_ASSET,
                TEST_SLICE_SIZE * 2n, // Exactly 2 slices
                TEST_SLICE_SIZE,
                TEST_INTERVAL,
                TEST_MIN_PRICE,
                TEST_MAX_PRICE,
                true,
                TEST_SECRET
            );
            smallOrderId = (await tx.wait()).logs[0].args.orderId;

            await mockOracle.setPrice(TEST_ASSET, ethers.parseUnits("55000", 6));
        });

        it("Should complete order after final slice execution", async function () {
            // Execute first slice
            await shieldedTWAP.executeTWAPSlice(smallOrderId, TEST_SECRET);

            // Skip time for next execution
            await ethers.provider.send("evm_increaseTime", [TEST_INTERVAL]);
            await ethers.provider.send("evm_mine");

            // Execute final slice
            const tx = await shieldedTWAP.executeTWAPSlice(smallOrderId, TEST_SECRET);
            const receipt = await tx.wait();

            // Verify completion event
            const completionEvent = receipt.logs.find(log => 
                log.fragment && log.fragment.name === "TWAPOrderCompleted"
            );
            expect(completionEvent).to.not.be.undefined;
            expect(completionEvent.args.orderId).to.equal(smallOrderId);
            expect(completionEvent.args.totalExecuted).to.equal(TEST_SLICE_SIZE * 2n);

            // Verify order is inactive
            const [active] = await shieldedTWAP.getOrderStatus(smallOrderId);
            expect(active).to.be.false;
        });

        it("Should reject execution attempts on completed order", async function () {
            // Complete the order first
            await shieldedTWAP.executeTWAPSlice(smallOrderId, TEST_SECRET);
            await ethers.provider.send("evm_increaseTime", [TEST_INTERVAL]);
            await shieldedTWAP.executeTWAPSlice(smallOrderId, TEST_SECRET);

            // Should reject further execution
            await expect(
                shieldedTWAP.executeTWAPSlice(smallOrderId, TEST_SECRET)
            ).to.be.revertedWith("Order not active");
        });
    });

    describe("Time-based Execution Control", function () {
        let orderId;

        beforeEach(async function () {
            const tx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                TEST_ASSET,
                TEST_TOTAL_SIZE,
                TEST_SLICE_SIZE,
                TEST_INTERVAL,
                TEST_MIN_PRICE,
                TEST_MAX_PRICE,
                true,
                TEST_SECRET
            );
            orderId = (await tx.wait()).logs[0].args.orderId;
            await mockOracle.setPrice(TEST_ASSET, ethers.parseUnits("55000", 6));
        });

        it("Should reject execution before next execution time", async function () {
            // Execute first slice
            await shieldedTWAP.executeTWAPSlice(orderId, TEST_SECRET);

            // Try to execute again immediately (should fail)
            await expect(
                shieldedTWAP.executeTWAPSlice(orderId, TEST_SECRET)
            ).to.be.revertedWith("Too early");
        });

        it("Should allow execution after interval has passed", async function () {
            // Execute first slice
            await shieldedTWAP.executeTWAPSlice(orderId, TEST_SECRET);

            // Skip time
            await ethers.provider.send("evm_increaseTime", [TEST_INTERVAL]);
            await ethers.provider.send("evm_mine");

            // Should allow second execution
            const result = await shieldedTWAP.executeTWAPSlice.staticCall(orderId, TEST_SECRET);
            expect(result.success).to.be.true;
        });

        it("Should update next execution time after each slice", async function () {
            const [,, , initialTime] = await shieldedTWAP.getOrderStatus(orderId);
            
            await shieldedTWAP.executeTWAPSlice(orderId, TEST_SECRET);
            
            const [,,, updatedTime] = await shieldedTWAP.getOrderStatus(orderId);
            expect(updatedTime).to.be.gt(initialTime);
        });
    });

    describe("Gas Optimization", function () {
        it("Should track gas usage in execution results", async function () {
            const tx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                TEST_ASSET,
                TEST_TOTAL_SIZE,
                TEST_SLICE_SIZE,
                TEST_INTERVAL,
                TEST_MIN_PRICE,
                TEST_MAX_PRICE,
                true,
                TEST_SECRET
            );
            const orderId = (await tx.wait()).logs[0].args.orderId;

            await mockOracle.setPrice(TEST_ASSET, ethers.parseUnits("55000", 6));

            const result = await shieldedTWAP.executeTWAPSlice.staticCall(orderId, TEST_SECRET);
            expect(result.gasUsed).to.be.gt(0);
        });

        it("Should have predictable gas costs for similar operations", async function () {
            // Create multiple identical orders
            const orders = [];
            const gasUsages = [];

            for (let i = 0; i < 3; i++) {
                const tx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                    TEST_ASSET,
                    TEST_TOTAL_SIZE,
                    TEST_SLICE_SIZE,
                    TEST_INTERVAL,
                    TEST_MIN_PRICE,
                    TEST_MAX_PRICE,
                    true,
                    ethers.keccak256(ethers.toUtf8Bytes(`secret${i}`))
                );
                orders.push((await tx.wait()).logs[0].args.orderId);
            }

            await mockOracle.setPrice(TEST_ASSET, ethers.parseUnits("55000", 6));

            // Execute all orders and compare gas usage
            for (const orderId of orders) {
                const result = await shieldedTWAP.executeTWAPSlice.staticCall(
                    orderId, 
                    ethers.keccak256(ethers.toUtf8Bytes(`secret${orders.indexOf(orderId)}`))
                );
                gasUsages.push(result.gasUsed);
            }

            // Gas usage should be similar (within 10% variance)
            const avgGas = gasUsages.reduce((a, b) => a + b, 0n) / BigInt(gasUsages.length);
            for (const gas of gasUsages) {
                const variance = gas > avgGas ? gas - avgGas : avgGas - gas;
                expect(variance).to.be.lt(avgGas / 10n); // Less than 10% variance
            }
        });
    });

    describe("Edge Cases and Error Handling", function () {
        it("Should handle zero address scenarios gracefully", async function () {
            const emptyOrders = await shieldedTWAP.getUserOrders(ethers.ZeroAddress);
            expect(emptyOrders.length).to.equal(0);
        });

        it("Should handle non-existent order queries", async function () {
            const fakeOrderId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
            const [active, executedSize, totalSize, nextTime] = 
                await shieldedTWAP.getOrderStatus(fakeOrderId);

            expect(active).to.be.false;
            expect(executedSize).to.equal(0);
            expect(totalSize).to.equal(0);
            expect(nextTime).to.equal(0);
        });

        it("Should handle maximum values correctly", async function () {
            const maxUint64 = 2n ** 64n - 1n;
            
            // Should not overflow on large values
            await expect(
                shieldedTWAP.connect(user1).createShieldedTWAP(
                    TEST_ASSET,
                    maxUint64,
                    1n,
                    TEST_INTERVAL,
                    0,
                    maxUint64,
                    true,
                    TEST_SECRET
                )
            ).to.be.revertedWith("Too many slices");
        });
    });
});

// Mock contract for CoreWriter
contract("MockCoreWriter", function () {
    let mockCoreWriter;

    beforeEach(async function () {
        const MockCoreWriter = await ethers.getContractFactory("MockCoreWriter");
        mockCoreWriter = await MockCoreWriter.deploy();
    });

    it("Should emit ActionSent event", async function () {
        const testData = "0x1234";
        await expect(mockCoreWriter.sendRawAction(testData))
            .to.emit(mockCoreWriter, "ActionSent")
            .withArgs(await mockCoreWriter.getAddress(), testData);
    });
});

// Additional mock contracts would be deployed via separate mock contract files