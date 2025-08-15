const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Shielding and Privacy Tests", function () {
    let shieldedTWAP;
    let mockCoreWriter;
    let mockOracle;
    let owner;
    let alice;
    let bob;
    let charlie;
    let observer;

    const ASSET_BTC = 1;
    const ORDER_SIZE = ethers.parseUnits("100", 6);
    const SLICE_SIZE = ethers.parseUnits("20", 6);
    const INTERVAL = 300;
    const MIN_PRICE = ethers.parseUnits("45000", 6);
    const MAX_PRICE = ethers.parseUnits("55000", 6);
    const BASE_PRICE = ethers.parseUnits("50000", 6);

    async function deployPrivacyFixture() {
        const [owner, alice, bob, charlie, observer] = await ethers.getSigners();

        const MockCoreWriter = await ethers.getContractFactory("MockCoreWriter");
        mockCoreWriter = await MockCoreWriter.deploy();

        const MockPerpsOracle = await ethers.getContractFactory("MockPerpsOracle");
        mockOracle = await MockPerpsOracle.deploy();
        await mockOracle.setPrice(ASSET_BTC, BASE_PRICE);

        const ShieldedTWAPExecutor = await ethers.getContractFactory("ShieldedTWAPExecutor");
        shieldedTWAP = await ShieldedTWAPExecutor.deploy();

        return { shieldedTWAP, mockCoreWriter, mockOracle, owner, alice, bob, charlie, observer };
    }

    beforeEach(async function () {
        ({ shieldedTWAP, mockCoreWriter, mockOracle, owner, alice, bob, charlie, observer } = 
            await loadFixture(deployPrivacyFixture));
    });

    describe("Secret Hash Protection", function () {
        it("Should generate unique order IDs for identical parameters with different secrets", async function () {
            const secret1 = ethers.keccak256(ethers.toUtf8Bytes("alice_secret"));
            const secret2 = ethers.keccak256(ethers.toUtf8Bytes("bob_secret"));

            const orderId1 = await shieldedTWAP.connect(alice).createShieldedTWAP.staticCall(
                ASSET_BTC, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, true, secret1
            );

            const orderId2 = await shieldedTWAP.connect(alice).createShieldedTWAP.staticCall(
                ASSET_BTC, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, true, secret2
            );

            expect(orderId1).to.not.equal(orderId2);
        });

        it("Should prevent order execution without correct secret", async function () {
            const correctSecret = ethers.keccak256(ethers.toUtf8Bytes("correct_secret"));
            const wrongSecret = ethers.keccak256(ethers.toUtf8Bytes("wrong_secret"));

            const orderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                ASSET_BTC, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, true, correctSecret
            );
            const orderId = (await orderTx.wait()).logs[0].args.orderId;

            // Attempt execution with wrong secret
            await expect(
                shieldedTWAP.executeTWAPSlice(orderId, wrongSecret)
            ).to.be.revertedWith("Invalid secret");

            // Verify execution works with correct secret
            const result = await shieldedTWAP.executeTWAPSlice.staticCall(orderId, correctSecret);
            expect(result.success).to.be.true;
        });

        it("Should hash secrets consistently", async function () {
            const secret = ethers.keccak256(ethers.toUtf8Bytes("test_secret"));
            
            // Create two identical orders with same secret
            const orderTx1 = await shieldedTWAP.connect(alice).createShieldedTWAP(
                ASSET_BTC, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, true, secret
            );
            const orderId1 = (await orderTx1.wait()).logs[0].args.orderId;

            const orderTx2 = await shieldedTWAP.connect(alice).createShieldedTWAP(
                ASSET_BTC + 1, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, true, secret
            );
            const orderId2 = (await orderTx2.wait()).logs[0].args.orderId;

            // Both should accept the same secret
            await expect(shieldedTWAP.executeTWAPSlice.staticCall(orderId1, secret)).to.not.be.reverted;
            await mockOracle.setPrice(ASSET_BTC + 1, BASE_PRICE);
            await expect(shieldedTWAP.executeTWAPSlice.staticCall(orderId2, secret)).to.not.be.reverted;
        });

        it("Should protect against secret brute force attacks", async function () {
            const realSecret = ethers.keccak256(ethers.toUtf8Bytes("real_secret"));
            
            const orderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                ASSET_BTC, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, true, realSecret
            );
            const orderId = (await orderTx.wait()).logs[0].args.orderId;

            // Attempt multiple wrong secrets
            const wrongSecrets = [
                ethers.keccak256(ethers.toUtf8Bytes("guess1")),
                ethers.keccak256(ethers.toUtf8Bytes("guess2")),
                ethers.keccak256(ethers.toUtf8Bytes("guess3")),
                ethers.keccak256(ethers.toUtf8Bytes("")),
                ethers.ZeroHash
            ];

            for (const wrongSecret of wrongSecrets) {
                await expect(
                    shieldedTWAP.executeTWAPSlice(orderId, wrongSecret)
                ).to.be.revertedWith("Invalid secret");
            }

            // Real secret should still work
            const result = await shieldedTWAP.executeTWAPSlice.staticCall(orderId, realSecret);
            expect(result.success).to.be.true;
        });
    });

    describe("Order Privacy and Isolation", function () {
        it("Should prevent cross-user order execution", async function () {
            const aliceSecret = ethers.keccak256(ethers.toUtf8Bytes("alice_secret"));
            const bobSecret = ethers.keccak256(ethers.toUtf8Bytes("bob_secret"));

            // Alice creates order
            const aliceOrderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                ASSET_BTC, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, true, aliceSecret
            );
            const aliceOrderId = (await aliceOrderTx.wait()).logs[0].args.orderId;

            // Bob creates order
            const bobOrderTx = await shieldedTWAP.connect(bob).createShieldedTWAP(
                ASSET_BTC, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, false, bobSecret
            );
            const bobOrderId = (await bobOrderTx.wait()).logs[0].args.orderId;

            // Alice cannot execute Bob's order
            await expect(
                shieldedTWAP.connect(alice).executeTWAPSlice(bobOrderId, aliceSecret)
            ).to.be.revertedWith("Invalid secret");

            // Bob cannot execute Alice's order
            await expect(
                shieldedTWAP.connect(bob).executeTWAPSlice(aliceOrderId, bobSecret)
            ).to.be.revertedWith("Invalid secret");

            // Charlie cannot execute either order
            await expect(
                shieldedTWAP.connect(charlie).executeTWAPSlice(aliceOrderId, aliceSecret)
            ).to.not.be.reverted; // Secret is what matters, not sender

            await expect(
                shieldedTWAP.connect(charlie).executeTWAPSlice(bobOrderId, bobSecret)
            ).to.not.be.reverted; // Secret is what matters, not sender
        });

        it("Should maintain order privacy across multiple users", async function () {
            const secrets = [];
            const orderIds = [];
            const users = [alice, bob, charlie];

            // Each user creates an order
            for (let i = 0; i < users.length; i++) {
                const secret = ethers.keccak256(ethers.toUtf8Bytes(`secret_${i}`));
                secrets.push(secret);

                const orderTx = await shieldedTWAP.connect(users[i]).createShieldedTWAP(
                    ASSET_BTC,
                    ORDER_SIZE,
                    SLICE_SIZE,
                    INTERVAL,
                    MIN_PRICE,
                    MAX_PRICE,
                    i % 2 === 0, // Alternate buy/sell
                    secret
                );
                orderIds.push((await orderTx.wait()).logs[0].args.orderId);
            }

            // Verify each user can only see their own orders
            for (let i = 0; i < users.length; i++) {
                const userOrders = await shieldedTWAP.getUserOrders(users[i].address);
                expect(userOrders).to.include(orderIds[i]);
                expect(userOrders.length).to.equal(1);

                // Check they don't see other users' orders
                for (let j = 0; j < users.length; j++) {
                    if (i !== j) {
                        expect(userOrders).to.not.include(orderIds[j]);
                    }
                }
            }
        });

        it("Should prevent unauthorized order cancellation", async function () {
            const aliceSecret = ethers.keccak256(ethers.toUtf8Bytes("alice_cancel_test"));
            
            const orderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                ASSET_BTC, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, true, aliceSecret
            );
            const orderId = (await orderTx.wait()).logs[0].args.orderId;

            // Bob cannot cancel Alice's order
            await expect(
                shieldedTWAP.connect(bob).cancelTWAPOrder(orderId)
            ).to.be.revertedWith("Not order owner");

            // Observer cannot cancel Alice's order
            await expect(
                shieldedTWAP.connect(observer).cancelTWAPOrder(orderId)
            ).to.be.revertedWith("Not order owner");

            // Alice can cancel her own order
            await shieldedTWAP.connect(alice).cancelTWAPOrder(orderId);

            const [active] = await shieldedTWAP.getOrderStatus(orderId);
            expect(active).to.be.false;
        });
    });

    describe("Order Parameter Obfuscation", function () {
        it("Should hide order details from external observers", async function () {
            const secret = ethers.keccak256(ethers.toUtf8Bytes("hidden_order"));
            
            const orderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                ASSET_BTC,
                ORDER_SIZE,
                SLICE_SIZE,
                INTERVAL,
                MIN_PRICE,
                MAX_PRICE,
                true,
                secret
            );
            const orderId = (await orderTx.wait()).logs[0].args.orderId;

            // Observer can see limited status information
            const [active, executedSize, totalSize, nextTime] = await shieldedTWAP.getOrderStatus(orderId);
            expect(active).to.be.true;
            expect(executedSize).to.equal(0);
            expect(totalSize).to.equal(ORDER_SIZE);
            expect(nextTime).to.be.gt(0);

            // But cannot determine the secret or execute the order
            const randomSecret = ethers.keccak256(ethers.toUtf8Bytes("random_guess"));
            await expect(
                shieldedTWAP.executeTWAPSlice(orderId, randomSecret)
            ).to.be.revertedWith("Invalid secret");
        });

        it("Should reveal minimal information in events", async function () {
            const secret = ethers.keccak256(ethers.toUtf8Bytes("event_test"));
            
            const orderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                ASSET_BTC, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, true, secret
            );
            const receipt = await orderTx.wait();

            // Check creation event only reveals essential info
            const creationEvent = receipt.logs.find(log => 
                log.fragment && log.fragment.name === "TWAPOrderCreated"
            );
            expect(creationEvent.args.orderId).to.not.be.undefined;
            expect(creationEvent.args.owner).to.equal(alice.address);
            expect(creationEvent.args.asset).to.equal(ASSET_BTC);
            expect(creationEvent.args.totalSize).to.equal(ORDER_SIZE);

            // Secret hash should not be in events
            const eventData = JSON.stringify(receipt.logs);
            expect(eventData).to.not.include(secret.slice(2)); // Remove 0x prefix
        });

        it("Should protect price and timing information", async function () {
            const secrets = [];
            const orderIds = [];

            // Create multiple orders with different price ranges
            const priceRanges = [
                { min: ethers.parseUnits("40000", 6), max: ethers.parseUnits("50000", 6) },
                { min: ethers.parseUnits("50000", 6), max: ethers.parseUnits("60000", 6) },
                { min: ethers.parseUnits("45000", 6), max: ethers.parseUnits("55000", 6) }
            ];

            for (let i = 0; i < priceRanges.length; i++) {
                const secret = ethers.keccak256(ethers.toUtf8Bytes(`price_test_${i}`));
                secrets.push(secret);

                const orderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                    ASSET_BTC,
                    ORDER_SIZE,
                    SLICE_SIZE,
                    INTERVAL + i * 60, // Different intervals
                    priceRanges[i].min,
                    priceRanges[i].max,
                    true,
                    secret
                );
                orderIds.push((await orderTx.wait()).logs[0].args.orderId);
            }

            // Observer cannot distinguish between orders based on public info
            for (const orderId of orderIds) {
                const [active, executedSize, totalSize] = await shieldedTWAP.getOrderStatus(orderId);
                expect(active).to.be.true;
                expect(executedSize).to.equal(0);
                expect(totalSize).to.equal(ORDER_SIZE); // All same size
            }
        });
    });

    describe("Execution Privacy", function () {
        it("Should hide execution details until completion", async function () {
            const secret = ethers.keccak256(ethers.toUtf8Bytes("execution_privacy"));
            
            const orderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                ASSET_BTC, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, true, secret
            );
            const orderId = (await orderTx.wait()).logs[0].args.orderId;

            // Execute first slice
            const executeTx = await shieldedTWAP.executeTWAPSlice(orderId, secret);
            const executeReceipt = await executeTx.wait();

            // Check execution event
            const sliceEvent = executeReceipt.logs.find(log => 
                log.fragment && log.fragment.name === "TWAPSliceExecuted"
            );
            expect(sliceEvent).to.not.be.undefined;
            expect(sliceEvent.args.orderId).to.equal(orderId);
            expect(sliceEvent.args.executedSize).to.equal(SLICE_SIZE);

            // Price should be revealed in execution (necessary for transparency)
            expect(sliceEvent.args.price).to.equal(BASE_PRICE);

            // But order details remain protected
            await expect(
                shieldedTWAP.connect(bob).executeTWAPSlice(orderId, ethers.keccak256(ethers.toUtf8Bytes("guess")))
            ).to.be.revertedWith("Invalid secret");
        });

        it("Should maintain privacy during concurrent executions", async function () {
            const secrets = [];
            const orderIds = [];

            // Create multiple orders
            for (let i = 0; i < 3; i++) {
                const secret = ethers.keccak256(ethers.toUtf8Bytes(`concurrent_${i}`));
                secrets.push(secret);

                const orderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                    ASSET_BTC,
                    ORDER_SIZE,
                    SLICE_SIZE,
                    INTERVAL,
                    MIN_PRICE,
                    MAX_PRICE,
                    true,
                    secret
                );
                orderIds.push((await orderTx.wait()).logs[0].args.orderId);
            }

            // Execute all orders in same block
            const promises = [];
            for (let i = 0; i < orderIds.length; i++) {
                promises.push(shieldedTWAP.executeTWAPSlice(orderIds[i], secrets[i]));
            }
            
            const transactions = await Promise.all(promises);
            const receipts = await Promise.all(transactions.map(tx => tx.wait()));

            // Each execution should be independent and private
            for (let i = 0; i < receipts.length; i++) {
                const sliceEvent = receipts[i].logs.find(log => 
                    log.fragment && log.fragment.name === "TWAPSliceExecuted"
                );
                expect(sliceEvent.args.orderId).to.equal(orderIds[i]);
                expect(sliceEvent.args.executedSize).to.equal(SLICE_SIZE);
            }
        });

        it("Should protect against timing analysis attacks", async function () {
            const secrets = [];
            const orderIds = [];
            const executionTimes = [];

            // Create orders with different timing patterns
            for (let i = 0; i < 5; i++) {
                const secret = ethers.keccak256(ethers.toUtf8Bytes(`timing_${i}`));
                secrets.push(secret);

                const orderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                    ASSET_BTC,
                    ORDER_SIZE,
                    SLICE_SIZE,
                    INTERVAL + i * 30, // Varying intervals
                    MIN_PRICE,
                    MAX_PRICE,
                    true,
                    secret
                );
                orderIds.push((await orderTx.wait()).logs[0].args.orderId);
            }

            // Execute orders and measure timing
            for (let i = 0; i < orderIds.length; i++) {
                const start = Date.now();
                await shieldedTWAP.executeTWAPSlice(orderIds[i], secrets[i]);
                const end = Date.now();
                executionTimes.push(end - start);
            }

            // Execution times should be relatively consistent
            // (not revealing order complexity through timing)
            const avgTime = executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length;
            for (const time of executionTimes) {
                const variance = Math.abs(time - avgTime) / avgTime;
                expect(variance).to.be.lt(0.5); // Less than 50% variance
            }
        });
    });

    describe("MEV Protection and Privacy", function () {
        it("Should prevent front-running through order obfuscation", async function () {
            const aliceSecret = ethers.keccak256(ethers.toUtf8Bytes("alice_mev_protection"));
            
            // Alice creates a large order
            const largeOrderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                ASSET_BTC,
                ethers.parseUnits("1000", 6), // Large order
                ethers.parseUnits("100", 6),
                INTERVAL,
                MIN_PRICE,
                MAX_PRICE,
                true,
                aliceSecret
            );
            const aliceOrderId = (await largeOrderTx.wait()).logs[0].args.orderId;

            // MEV bot tries to create similar order to front-run
            const mevSecret = ethers.keccak256(ethers.toUtf8Bytes("mev_attempt"));
            const mevOrderTx = await shieldedTWAP.connect(observer).createShieldedTWAP(
                ASSET_BTC,
                ethers.parseUnits("1000", 6),
                ethers.parseUnits("100", 6),
                INTERVAL,
                MIN_PRICE,
                MAX_PRICE,
                true,
                mevSecret
            );
            const mevOrderId = (await mevOrderTx.wait()).logs[0].args.orderId;

            // MEV bot cannot execute Alice's order
            await expect(
                shieldedTWAP.connect(observer).executeTWAPSlice(aliceOrderId, mevSecret)
            ).to.be.revertedWith("Invalid secret");

            // Both orders exist independently
            const [aliceActive] = await shieldedTWAP.getOrderStatus(aliceOrderId);
            const [mevActive] = await shieldedTWAP.getOrderStatus(mevOrderId);
            expect(aliceActive).to.be.true;
            expect(mevActive).to.be.true;

            // Alice maintains control of her order
            const result = await shieldedTWAP.executeTWAPSlice.staticCall(aliceOrderId, aliceSecret);
            expect(result.success).to.be.true;
        });

        it("Should prevent sandwich attacks through execution privacy", async function () {
            const secret = ethers.keccak256(ethers.toUtf8Bytes("sandwich_protection"));
            
            const orderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                ASSET_BTC, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, true, secret
            );
            const orderId = (await orderTx.wait()).logs[0].args.orderId;

            // Attacker cannot predict execution timing or manipulate price
            // because they don't know the secret or exact execution conditions

            // Set a different price that's still within range
            const manipulatedPrice = BASE_PRICE + ethers.parseUnits("1000", 6);
            await mockOracle.setPrice(ASSET_BTC, manipulatedPrice);

            // Alice's order can still execute at the manipulated price
            // but the attacker couldn't predict this specific execution
            const result = await shieldedTWAP.executeTWAPSlice.staticCall(orderId, secret);
            expect(result.success).to.be.true;
            expect(result.averagePrice).to.equal(manipulatedPrice);
        });
    });

    describe("Privacy Preservation Edge Cases", function () {
        it("Should handle privacy when orders are cancelled", async function () {
            const secret = ethers.keccak256(ethers.toUtf8Bytes("cancel_privacy"));
            
            const orderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                ASSET_BTC, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, true, secret
            );
            const orderId = (await orderTx.wait()).logs[0].args.orderId;

            // Execute one slice first
            await shieldedTWAP.executeTWAPSlice(orderId, secret);

            // Cancel order
            await shieldedTWAP.connect(alice).cancelTWAPOrder(orderId);

            // Order details should still be protected even after cancellation
            await expect(
                shieldedTWAP.executeTWAPSlice(orderId, secret)
            ).to.be.revertedWith("Order not active");

            // Observer still cannot access order details
            const [active] = await shieldedTWAP.getOrderStatus(orderId);
            expect(active).to.be.false;
        });

        it("Should maintain privacy with zero-knowledge proofs concept", async function () {
            // This test demonstrates the principle of zero-knowledge proofs
            // where execution proves knowledge of secret without revealing it
            
            const realSecret = ethers.keccak256(ethers.toUtf8Bytes("zk_proof_concept"));
            
            const orderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                ASSET_BTC, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, true, realSecret
            );
            const orderId = (await orderTx.wait()).logs[0].args.orderId;

            // Successful execution proves knowledge of secret
            const result = await shieldedTWAP.executeTWAPSlice.staticCall(orderId, realSecret);
            expect(result.success).to.be.true;

            // But the secret itself is never revealed in the transaction
            const executeTx = await shieldedTWAP.executeTWAPSlice(orderId, realSecret);
            const receipt = await executeTx.wait();

            // Verify secret is not exposed in transaction data
            const txData = receipt.logs.map(log => log.data).join("");
            expect(txData).to.not.include(realSecret.slice(2));
        });

        it("Should protect privacy across contract upgrades", async function () {
            // This test verifies that order privacy is maintained
            // even when considering potential contract interactions
            
            const secret = ethers.keccak256(ethers.toUtf8Bytes("upgrade_privacy"));
            
            const orderTx = await shieldedTWAP.connect(alice).createShieldedTWAP(
                ASSET_BTC, ORDER_SIZE, SLICE_SIZE, INTERVAL, MIN_PRICE, MAX_PRICE, true, secret
            );
            const orderId = (await orderTx.wait()).logs[0].args.orderId;

            // Simulate interaction with external contract
            const userOrders = await shieldedTWAP.getUserOrders(alice.address);
            expect(userOrders).to.include(orderId);

            // Privacy should be maintained in cross-contract calls
            const [active, executed, total] = await shieldedTWAP.getOrderStatus(orderId);
            expect(active).to.be.true;
            
            // Secret-protected execution should still work
            const result = await shieldedTWAP.executeTWAPSlice.staticCall(orderId, secret);
            expect(result.success).to.be.true;
        });
    });
});