const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Performance and Gas Optimization Tests", function () {
    let shieldedTWAP;
    let mockCoreWriter;
    let mockOracle;
    let owner;
    let user1;
    let user2;
    
    const ASSET_BTC = 1;
    const BASE_ORDER_SIZE = ethers.parseUnits("100", 6);
    const BASE_SLICE_SIZE = ethers.parseUnits("20", 6);
    const INTERVAL = 300;
    const MIN_PRICE = ethers.parseUnits("45000", 6);
    const MAX_PRICE = ethers.parseUnits("55000", 6);
    const BASE_PRICE = ethers.parseUnits("50000", 6);

    // Gas benchmarks (these should be updated based on actual measurements)
    const GAS_BENCHMARKS = {
        ORDER_CREATION: 150000,
        SLICE_EXECUTION: 100000,
        ORDER_CANCELLATION: 80000,
        STATUS_QUERY: 30000
    };

    async function deployPerformanceFixture() {
        const [owner, user1, user2] = await ethers.getSigners();

        const MockCoreWriter = await ethers.getContractFactory("MockCoreWriter");
        mockCoreWriter = await MockCoreWriter.deploy();

        const MockPerpsOracle = await ethers.getContractFactory("MockPerpsOracle");
        mockOracle = await MockPerpsOracle.deploy();
        await mockOracle.setPrice(ASSET_BTC, BASE_PRICE);

        const ShieldedTWAPExecutor = await ethers.getContractFactory("ShieldedTWAPExecutor");
        shieldedTWAP = await ShieldedTWAPExecutor.deploy();

        return { shieldedTWAP, mockCoreWriter, mockOracle, owner, user1, user2 };
    }

    beforeEach(async function () {
        ({ shieldedTWAP, mockCoreWriter, mockOracle, owner, user1, user2 } = 
            await loadFixture(deployPerformanceFixture));
    });

    describe("Gas Consumption Benchmarks", function () {
        it("Should create orders within gas budget", async function () {
            const secret = ethers.keccak256(ethers.toUtf8Bytes("gas_test_create"));

            const tx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                ASSET_BTC,
                BASE_ORDER_SIZE,
                BASE_SLICE_SIZE,
                INTERVAL,
                MIN_PRICE,
                MAX_PRICE,
                true,
                secret
            );
            const receipt = await tx.wait();

            console.log(`Order creation gas used: ${receipt.gasUsed}`);
            expect(receipt.gasUsed).to.be.lt(GAS_BENCHMARKS.ORDER_CREATION);
        });

        it("Should execute slices within gas budget", async function () {
            const secret = ethers.keccak256(ethers.toUtf8Bytes("gas_test_execute"));

            const createTx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                ASSET_BTC,
                BASE_ORDER_SIZE,
                BASE_SLICE_SIZE,
                INTERVAL,
                MIN_PRICE,
                MAX_PRICE,
                true,
                secret
            );
            const orderId = (await createTx.wait()).logs[0].args.orderId;

            const executeTx = await shieldedTWAP.executeTWAPSlice(orderId, secret);
            const receipt = await executeTx.wait();

            console.log(`Slice execution gas used: ${receipt.gasUsed}`);
            expect(receipt.gasUsed).to.be.lt(GAS_BENCHMARKS.SLICE_EXECUTION);
        });

        it("Should cancel orders within gas budget", async function () {
            const secret = ethers.keccak256(ethers.toUtf8Bytes("gas_test_cancel"));

            const createTx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                ASSET_BTC,
                BASE_ORDER_SIZE,
                BASE_SLICE_SIZE,
                INTERVAL,
                MIN_PRICE,
                MAX_PRICE,
                true,
                secret
            );
            const orderId = (await createTx.wait()).logs[0].args.orderId;

            // Execute one slice first to test cancellation with partial execution
            await shieldedTWAP.executeTWAPSlice(orderId, secret);

            const cancelTx = await shieldedTWAP.connect(user1).cancelTWAPOrder(orderId);
            const receipt = await cancelTx.wait();

            console.log(`Order cancellation gas used: ${receipt.gasUsed}`);
            expect(receipt.gasUsed).to.be.lt(GAS_BENCHMARKS.ORDER_CANCELLATION);
        });

        it("Should query status with minimal gas", async function () {
            const secret = ethers.keccak256(ethers.toUtf8Bytes("gas_test_query"));

            const createTx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                ASSET_BTC,
                BASE_ORDER_SIZE,
                BASE_SLICE_SIZE,
                INTERVAL,
                MIN_PRICE,
                MAX_PRICE,
                true,
                secret
            );
            const orderId = (await createTx.wait()).logs[0].args.orderId;

            // Estimate gas for view function
            const gasEstimate = await shieldedTWAP.getOrderStatus.estimateGas(orderId);
            
            console.log(`Status query gas estimate: ${gasEstimate}`);
            expect(gasEstimate).to.be.lt(GAS_BENCHMARKS.STATUS_QUERY);
        });
    });

    describe("Gas Efficiency Under Load", function () {
        it("Should maintain consistent gas usage with multiple orders", async function () {
            const gasUsages = [];
            const orderCount = 10;

            for (let i = 0; i < orderCount; i++) {
                const secret = ethers.keccak256(ethers.toUtf8Bytes(`load_test_${i}`));
                
                const tx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                    ASSET_BTC,
                    BASE_ORDER_SIZE,
                    BASE_SLICE_SIZE,
                    INTERVAL,
                    MIN_PRICE,
                    MAX_PRICE,
                    true,
                    secret
                );
                const receipt = await tx.wait();
                gasUsages.push(Number(receipt.gasUsed));
            }

            // Calculate variance in gas usage
            const avgGas = gasUsages.reduce((a, b) => a + b, 0) / gasUsages.length;
            const maxVariance = Math.max(...gasUsages.map(gas => Math.abs(gas - avgGas)));
            const variancePercent = (maxVariance / avgGas) * 100;

            console.log(`Average gas: ${avgGas}, Max variance: ${variancePercent.toFixed(2)}%`);
            
            // Gas usage should be consistent (within 5% variance)
            expect(variancePercent).to.be.lt(5);

            // All gas usages should be within benchmark
            for (const gasUsed of gasUsages) {
                expect(gasUsed).to.be.lt(GAS_BENCHMARKS.ORDER_CREATION);
            }
        });

        it("Should handle batch operations efficiently", async function () {
            const batchSize = 20;
            const secrets = [];
            const orderIds = [];
            
            // Create batch of orders
            const createGasUsages = [];
            for (let i = 0; i < batchSize; i++) {
                const secret = ethers.keccak256(ethers.toUtf8Bytes(`batch_${i}`));
                secrets.push(secret);
                
                const tx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                    ASSET_BTC,
                    BASE_SLICE_SIZE, // Single slice orders
                    BASE_SLICE_SIZE,
                    INTERVAL,
                    MIN_PRICE,
                    MAX_PRICE,
                    true,
                    secret
                );
                const receipt = await tx.wait();
                createGasUsages.push(Number(receipt.gasUsed));
                orderIds.push(receipt.logs[0].args.orderId);
            }

            // Execute all orders (batch execution test)
            const executeGasUsages = [];
            for (let i = 0; i < orderIds.length; i++) {
                const tx = await shieldedTWAP.executeTWAPSlice(orderIds[i], secrets[i]);
                const receipt = await tx.wait();
                executeGasUsages.push(Number(receipt.gasUsed));
            }

            // Analyze batch performance
            const avgCreateGas = createGasUsages.reduce((a, b) => a + b, 0) / createGasUsages.length;
            const avgExecuteGas = executeGasUsages.reduce((a, b) => a + b, 0) / executeGasUsages.length;

            console.log(`Batch create avg gas: ${avgCreateGas}`);
            console.log(`Batch execute avg gas: ${avgExecuteGas}`);

            // Batch operations should maintain efficiency
            expect(avgCreateGas).to.be.lt(GAS_BENCHMARKS.ORDER_CREATION);
            expect(avgExecuteGas).to.be.lt(GAS_BENCHMARKS.SLICE_EXECUTION);
        });

        it("Should scale efficiently with order size", async function () {
            const orderSizes = [
                ethers.parseUnits("10", 6),   // Small
                ethers.parseUnits("100", 6),  // Medium
                ethers.parseUnits("1000", 6), // Large
                ethers.parseUnits("10000", 6) // Very large
            ];

            const createGasUsages = [];
            const executeGasUsages = [];

            for (let i = 0; i < orderSizes.length; i++) {
                const secret = ethers.keccak256(ethers.toUtf8Bytes(`scale_test_${i}`));
                
                // Create order
                const createTx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                    ASSET_BTC,
                    orderSizes[i],
                    BASE_SLICE_SIZE,
                    INTERVAL,
                    MIN_PRICE,
                    MAX_PRICE,
                    true,
                    secret
                );
                const createReceipt = await createTx.wait();
                createGasUsages.push(Number(createReceipt.gasUsed));
                
                const orderId = createReceipt.logs[0].args.orderId;

                // Execute first slice
                const executeTx = await shieldedTWAP.executeTWAPSlice(orderId, secret);
                const executeReceipt = await executeTx.wait();
                executeGasUsages.push(Number(executeReceipt.gasUsed));
            }

            // Gas usage should not increase significantly with order size
            const createVariance = Math.max(...createGasUsages) - Math.min(...createGasUsages);
            const executeVariance = Math.max(...executeGasUsages) - Math.min(...executeGasUsages);

            console.log(`Create gas variance across order sizes: ${createVariance}`);
            console.log(`Execute gas variance across order sizes: ${executeVariance}`);

            // Variance should be minimal since we're only executing one slice
            expect(createVariance).to.be.lt(20000); // Reasonable variance for storage operations
            expect(executeVariance).to.be.lt(10000); // Should be nearly constant
        });
    });

    describe("Memory and Storage Optimization", function () {
        it("Should optimize storage reads and writes", async function () {
            const secret = ethers.keccak256(ethers.toUtf8Bytes("storage_test"));
            
            const createTx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                ASSET_BTC,
                BASE_ORDER_SIZE,
                BASE_SLICE_SIZE,
                INTERVAL,
                MIN_PRICE,
                MAX_PRICE,
                true,
                secret
            );
            const orderId = (await createTx.wait()).logs[0].args.orderId;

            // Measure gas for multiple status queries (should be cached/optimized)
            const queries = [];
            for (let i = 0; i < 5; i++) {
                const gasEstimate = await shieldedTWAP.getOrderStatus.estimateGas(orderId);
                queries.push(Number(gasEstimate));
            }

            // All queries should have similar gas cost (no storage optimization degradation)
            const avgGas = queries.reduce((a, b) => a + b, 0) / queries.length;
            const maxDeviation = Math.max(...queries.map(gas => Math.abs(gas - avgGas)));
            
            expect(maxDeviation).to.be.lt(avgGas * 0.1); // Less than 10% deviation
        });

        it("Should handle high order count efficiently", async function () {
            const orderCount = 100;
            const secrets = [];
            const orderIds = [];
            
            console.log(`Creating ${orderCount} orders...`);
            const startTime = Date.now();

            // Create many orders
            for (let i = 0; i < orderCount; i++) {
                const secret = ethers.keccak256(ethers.toUtf8Bytes(`high_count_${i}`));
                secrets.push(secret);
                
                const tx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                    ASSET_BTC,
                    BASE_SLICE_SIZE,
                    BASE_SLICE_SIZE,
                    INTERVAL,
                    MIN_PRICE,
                    MAX_PRICE,
                    true,
                    secret
                );
                const receipt = await tx.wait();
                orderIds.push(receipt.logs[0].args.orderId);
                
                // Log progress every 20 orders
                if ((i + 1) % 20 === 0) {
                    console.log(`Created ${i + 1}/${orderCount} orders`);
                }
            }

            const createTime = Date.now() - startTime;
            console.log(`Order creation completed in ${createTime}ms`);

            // Query user orders (should handle large arrays efficiently)
            const queryStartTime = Date.now();
            const userOrders = await shieldedTWAP.getUserOrders(user1.address);
            const queryTime = Date.now() - queryStartTime;

            console.log(`User orders query completed in ${queryTime}ms`);
            
            expect(userOrders.length).to.equal(orderCount);
            expect(queryTime).to.be.lt(5000); // Should complete within 5 seconds
        });
    });

    describe("Computational Complexity Analysis", function () {
        it("Should have O(1) complexity for order execution", async function () {
            const complexities = [];
            const sliceSizes = [
                ethers.parseUnits("1", 6),
                ethers.parseUnits("10", 6),
                ethers.parseUnits("100", 6),
                ethers.parseUnits("1000", 6)
            ];

            for (let i = 0; i < sliceSizes.length; i++) {
                const secret = ethers.keccak256(ethers.toUtf8Bytes(`complexity_${i}`));
                
                const createTx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                    ASSET_BTC,
                    sliceSizes[i] * 5n, // 5 slices
                    sliceSizes[i],
                    INTERVAL,
                    MIN_PRICE,
                    MAX_PRICE,
                    true,
                    secret
                );
                const orderId = (await createTx.wait()).logs[0].args.orderId;

                const executeTx = await shieldedTWAP.executeTWAPSlice(orderId, secret);
                const receipt = await executeTx.wait();
                complexities.push(Number(receipt.gasUsed));
            }

            // Gas usage should remain relatively constant regardless of slice size
            // (indicating O(1) complexity)
            const avgGas = complexities.reduce((a, b) => a + b, 0) / complexities.length;
            const maxDeviation = Math.max(...complexities.map(gas => Math.abs(gas - avgGas)));
            const deviationPercent = (maxDeviation / avgGas) * 100;

            console.log(`Complexity analysis - Avg gas: ${avgGas}, Max deviation: ${deviationPercent.toFixed(2)}%`);
            
            // Should maintain O(1) complexity (within 15% variance)
            expect(deviationPercent).to.be.lt(15);
        });

        it("Should have predictable gas costs for different operations", async function () {
            const operations = {
                create: [],
                execute: [],
                status: [],
                cancel: []
            };

            const testCount = 10;
            const secrets = [];
            const orderIds = [];

            // Create orders
            for (let i = 0; i < testCount; i++) {
                const secret = ethers.keccak256(ethers.toUtf8Bytes(`predictable_${i}`));
                secrets.push(secret);
                
                const tx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                    ASSET_BTC,
                    BASE_ORDER_SIZE,
                    BASE_SLICE_SIZE,
                    INTERVAL,
                    MIN_PRICE,
                    MAX_PRICE,
                    true,
                    secret
                );
                const receipt = await tx.wait();
                operations.create.push(Number(receipt.gasUsed));
                orderIds.push(receipt.logs[0].args.orderId);
            }

            // Execute slices
            for (let i = 0; i < testCount; i++) {
                const tx = await shieldedTWAP.executeTWAPSlice(orderIds[i], secrets[i]);
                const receipt = await tx.wait();
                operations.execute.push(Number(receipt.gasUsed));
            }

            // Query status
            for (let i = 0; i < testCount; i++) {
                const gasEstimate = await shieldedTWAP.getOrderStatus.estimateGas(orderIds[i]);
                operations.status.push(Number(gasEstimate));
            }

            // Cancel orders
            for (let i = 0; i < testCount; i++) {
                const tx = await shieldedTWAP.connect(user1).cancelTWAPOrder(orderIds[i]);
                const receipt = await tx.wait();
                operations.cancel.push(Number(receipt.gasUsed));
            }

            // Analyze predictability of each operation
            for (const [operation, gasUsages] of Object.entries(operations)) {
                const avg = gasUsages.reduce((a, b) => a + b, 0) / gasUsages.length;
                const maxDeviation = Math.max(...gasUsages.map(gas => Math.abs(gas - avg)));
                const variancePercent = (maxDeviation / avg) * 100;

                console.log(`${operation} - Avg: ${avg}, Variance: ${variancePercent.toFixed(2)}%`);
                
                // Each operation should have predictable gas costs (within 10% variance)
                expect(variancePercent).to.be.lt(10);
            }
        });
    });

    describe("Real-world Performance Scenarios", function () {
        it("Should handle high-frequency execution efficiently", async function () {
            const secret = ethers.keccak256(ethers.toUtf8Bytes("hf_performance"));
            
            // Create order with many small slices (high frequency scenario)
            const orderTx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                ASSET_BTC,
                ethers.parseUnits("1000", 6), // Large order
                ethers.parseUnits("10", 6),   // Small slices
                60, // 1-minute intervals
                MIN_PRICE,
                MAX_PRICE,
                true,
                secret
            );
            const orderId = (await orderTx.wait()).logs[0].args.orderId;

            const executionGasUsages = [];
            const totalSlices = 10; // Execute 10 slices

            for (let i = 0; i < totalSlices; i++) {
                const tx = await shieldedTWAP.executeTWAPSlice(orderId, secret);
                const receipt = await tx.wait();
                executionGasUsages.push(Number(receipt.gasUsed));

                if (i < totalSlices - 1) {
                    await time.increase(60);
                }
            }

            // High-frequency execution should maintain consistent gas usage
            const avgGas = executionGasUsages.reduce((a, b) => a + b, 0) / executionGasUsages.length;
            const maxDeviation = Math.max(...executionGasUsages.map(gas => Math.abs(gas - avgGas)));
            const variancePercent = (maxDeviation / avgGas) * 100;

            console.log(`High-frequency execution - Avg gas: ${avgGas}, Variance: ${variancePercent.toFixed(2)}%`);
            
            // Should maintain efficiency across multiple executions
            expect(variancePercent).to.be.lt(8);
            expect(avgGas).to.be.lt(GAS_BENCHMARKS.SLICE_EXECUTION);
        });

        it("Should optimize gas for partial order completion", async function () {
            const secret = ethers.keccak256(ethers.toUtf8Bytes("partial_completion"));
            
            // Create order that will be partially completed
            const orderTx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                ASSET_BTC,
                BASE_SLICE_SIZE * 3n + BASE_SLICE_SIZE / 2n, // 3.5 slices
                BASE_SLICE_SIZE,
                INTERVAL,
                MIN_PRICE,
                MAX_PRICE,
                true,
                secret
            );
            const orderId = (await orderTx.wait()).logs[0].args.orderId;

            const sliceGasUsages = [];

            // Execute 3 full slices
            for (let i = 0; i < 3; i++) {
                const tx = await shieldedTWAP.executeTWAPSlice(orderId, secret);
                const receipt = await tx.wait();
                sliceGasUsages.push({
                    slice: i + 1,
                    gasUsed: Number(receipt.gasUsed),
                    isPartial: false
                });
                
                if (i < 2) await time.increase(INTERVAL);
            }

            await time.increase(INTERVAL);

            // Execute final partial slice (should trigger completion logic)
            const finalTx = await shieldedTWAP.executeTWAPSlice(orderId, secret);
            const finalReceipt = await finalTx.wait();
            sliceGasUsages.push({
                slice: 4,
                gasUsed: Number(finalReceipt.gasUsed),
                isPartial: true,
                isCompletion: true
            });

            // Analyze gas usage patterns
            const regularSlices = sliceGasUsages.filter(s => !s.isPartial);
            const partialSlices = sliceGasUsages.filter(s => s.isPartial);

            const avgRegularGas = regularSlices.reduce((a, b) => a + b.gasUsed, 0) / regularSlices.length;
            const partialGas = partialSlices[0].gasUsed;

            console.log(`Regular slice avg gas: ${avgRegularGas}`);
            console.log(`Partial completion gas: ${partialGas}`);

            // Partial slice with completion should use more gas (due to completion logic)
            // but still within reasonable bounds
            expect(partialGas).to.be.gt(avgRegularGas);
            expect(partialGas).to.be.lt(avgRegularGas * 1.5); // At most 50% more
        });

        it("Should benchmark against theoretical optimal gas usage", async function () {
            const secret = ethers.keccak256(ethers.toUtf8Bytes("optimal_benchmark"));
            
            // Create a standard order for benchmarking
            const createTx = await shieldedTWAP.connect(user1).createShieldedTWAP(
                ASSET_BTC,
                BASE_ORDER_SIZE,
                BASE_SLICE_SIZE,
                INTERVAL,
                MIN_PRICE,
                MAX_PRICE,
                true,
                secret
            );
            const createReceipt = await createTx.wait();
            const orderId = createReceipt.logs[0].args.orderId;

            const executeTx = await shieldedTWAP.executeTWAPSlice(orderId, secret);
            const executeReceipt = await executeTx.wait();

            // Theoretical minimum gas usage analysis
            const theoreticalMinimum = {
                // Storage writes (SSTORE operations)
                storageWrites: 5 * 20000, // ~5 storage updates at 20k gas each
                // External calls
                oracleCall: 2600, // CALL operation
                coreWriterCall: 2600, // CALL operation
                // Computation and memory
                computation: 10000, // Hash operations, arithmetic
                // Event emission
                events: 2000
            };

            const theoreticalMin = Object.values(theoreticalMinimum).reduce((a, b) => a + b, 0);
            
            console.log(`Theoretical minimum gas: ${theoreticalMin}`);
            console.log(`Actual execution gas: ${executeReceipt.gasUsed}`);
            console.log(`Efficiency ratio: ${(theoreticalMin / Number(executeReceipt.gasUsed) * 100).toFixed(2)}%`);

            // Actual gas usage should be reasonably close to theoretical minimum
            // (within 2x of theoretical minimum is considered good)
            expect(Number(executeReceipt.gasUsed)).to.be.lt(theoreticalMin * 2);
        });
    });
});