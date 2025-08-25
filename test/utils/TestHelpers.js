const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Test Helper Utilities for TWAP Testing
 * Common functions and patterns used across test suites
 */
class TestHelpers {
    constructor() {
        this.deployedContracts = new Map();
        this.testAccounts = [];
        this.snapshots = [];
    }

    /**
     * Deploy all necessary mock contracts for testing
     */
    async deployMockContracts() {
        // Deploy MockCoreWriter
        const MockCoreWriter = await ethers.getContractFactory("MockCoreWriter");
        const mockCoreWriter = await MockCoreWriter.deploy();
        
        // Deploy MockPerpsOracle
        const MockPerpsOracle = await ethers.getContractFactory("MockPerpsOracle");
        const mockOracle = await MockPerpsOracle.deploy();
        
        // Deploy ShieldedTWAPExecutor
        const ShieldedTWAPExecutor = await ethers.getContractFactory("ShieldedTWAPExecutor");
        const shieldedTWAP = await ShieldedTWAPExecutor.deploy();

        const contracts = {
            mockCoreWriter,
            mockOracle,
            shieldedTWAP
        };

        // Store for reuse
        this.deployedContracts.set('default', contracts);
        return contracts;
    }

    /**
     * Setup test accounts with different roles
     */
    async setupTestAccounts() {
        const signers = await ethers.getSigners();
        
        this.testAccounts = {
            deployer: signers[0],
            trader1: signers[1],
            trader2: signers[2],
            trader3: signers[3],
            liquidityProvider: signers[4],
            arbitrageur: signers[5],
            mevBot: signers[6],
            observer: signers[7],
            attacker: signers[8],
            admin: signers[9]
        };

        return this.testAccounts;
    }

    /**
     * Create a standard TWAP order with common parameters
     */
    async createStandardOrder(shieldedTWAP, user, overrides = {}) {
        const defaults = {
            asset: 1,
            totalSize: ethers.parseUnits("100", 6),
            sliceSize: ethers.parseUnits("20", 6),
            interval: 300,
            minPrice: ethers.parseUnits("45000", 6),
            maxPrice: ethers.parseUnits("55000", 6),
            isBuy: true,
            secret: ethers.keccak256(ethers.toUtf8Bytes("default_secret"))
        };

        const params = { ...defaults, ...overrides };

        const tx = await shieldedTWAP.connect(user).createShieldedTWAP(
            params.asset,
            params.totalSize,
            params.sliceSize,
            params.interval,
            params.minPrice,
            params.maxPrice,
            params.isBuy,
            params.secret
        );

        const receipt = await tx.wait();
        const orderId = receipt.logs[0].args.orderId;

        return {
            orderId,
            params,
            tx,
            receipt
        };
    }

    /**
     * Execute multiple TWAP slices with time progression
     */
    async executeMultipleSlices(shieldedTWAP, orderId, secret, sliceCount, interval = 300) {
        const results = [];
        
        for (let i = 0; i < sliceCount; i++) {
            try {
                const tx = await shieldedTWAP.executeTWAPSlice(orderId, secret);
                const receipt = await tx.wait();
                
                results.push({
                    slice: i + 1,
                    success: true,
                    tx,
                    receipt,
                    gasUsed: receipt.gasUsed
                });
                
                // Skip time for next slice (except for last slice)
                if (i < sliceCount - 1) {
                    await time.increase(interval);
                }
            } catch (error) {
                results.push({
                    slice: i + 1,
                    success: false,
                    error: error.message
                });
                break;
            }
        }

        return results;
    }

    /**
     * Setup mock oracle with realistic price data
     */
    async setupMockOracle(mockOracle, assetConfigs = []) {
        const defaultConfigs = [
            { asset: 1, basePrice: ethers.parseUnits("50000", 6), symbol: "BTC" },
            { asset: 2, basePrice: ethers.parseUnits("3000", 6), symbol: "ETH" },
            { asset: 3, basePrice: ethers.parseUnits("100", 6), symbol: "SOL" }
        ];

        const configs = assetConfigs.length > 0 ? assetConfigs : defaultConfigs;
        
        for (const config of configs) {
            await mockOracle.setPrice(config.asset, config.basePrice);
        }

        return configs;
    }

    /**
     * Generate random but realistic secrets for testing
     */
    generateSecrets(count, prefix = "test_secret") {
        const secrets = [];
        
        for (let i = 0; i < count; i++) {
            const randomSuffix = Math.random().toString(36).substring(2, 15);
            const secret = ethers.keccak256(ethers.toUtf8Bytes(`${prefix}_${i}_${randomSuffix}`));
            secrets.push(secret);
        }

        return secrets;
    }

    /**
     * Create multiple orders for batch testing
     */
    async createBatchOrders(shieldedTWAP, users, orderConfigs) {
        const orders = [];
        
        for (let i = 0; i < orderConfigs.length; i++) {
            const config = orderConfigs[i];
            const user = users[i % users.length];
            
            const order = await this.createStandardOrder(shieldedTWAP, user, config);
            orders.push({
                ...order,
                user: user.address,
                userIndex: i % users.length
            });
        }

        return orders;
    }

    /**
     * Measure gas usage for multiple operations
     */
    async measureGasUsage(operations) {
        const results = [];
        
        for (const operation of operations) {
            let gasUsed = 0n;
            let success = true;
            let error = null;

            try {
                if (operation.type === 'transaction') {
                    const tx = await operation.execute();
                    const receipt = await tx.wait();
                    gasUsed = receipt.gasUsed;
                } else if (operation.type === 'call') {
                    gasUsed = await operation.execute();
                } else {
                    throw new Error(`Unknown operation type: ${operation.type}`);
                }
            } catch (e) {
                success = false;
                error = e.message;
            }

            results.push({
                name: operation.name,
                type: operation.type,
                gasUsed: Number(gasUsed),
                success,
                error
            });
        }

        return results;
    }

    /**
     * Simulate price movements for testing
     */
    async simulatePriceMovement(mockOracle, asset, basePrice, steps, volatilityPercent = 2) {
        const prices = [];
        let currentPrice = basePrice;

        for (let i = 0; i < steps; i++) {
            // Random walk with mean reversion
            const randomFactor = (Math.random() - 0.5) * 2;
            const volatilityFactor = volatilityPercent / 100;
            const meanReversion = (basePrice - currentPrice) / basePrice * 0.1;
            
            const priceChange = currentPrice * BigInt(Math.floor((randomFactor * volatilityFactor + meanReversion) * 1e6)) / 1000000n;
            currentPrice += priceChange;
            
            // Ensure price doesn't go negative
            if (currentPrice < basePrice / 10n) currentPrice = basePrice / 10n;
            if (currentPrice > basePrice * 10n) currentPrice = basePrice * 10n;

            await mockOracle.setPrice(asset, currentPrice);
            prices.push(currentPrice);
        }

        return prices;
    }

    /**
     * Create test scenarios for stress testing
     */
    createTestScenarios() {
        return {
            // Normal operations
            standard: {
                name: "Standard Order",
                orderSize: ethers.parseUnits("100", 6),
                sliceSize: ethers.parseUnits("20", 6),
                interval: 300,
                priceVolatility: 2
            },

            // Large order testing
            large: {
                name: "Large Order",
                orderSize: ethers.parseUnits("10000", 6),
                sliceSize: ethers.parseUnits("500", 6),
                interval: 600,
                priceVolatility: 3
            },

            // High frequency testing
            highFreq: {
                name: "High Frequency",
                orderSize: ethers.parseUnits("50", 6),
                sliceSize: ethers.parseUnits("5", 6),
                interval: 60,
                priceVolatility: 5
            },

            // Edge case: Single slice
            singleSlice: {
                name: "Single Slice",
                orderSize: ethers.parseUnits("20", 6),
                sliceSize: ethers.parseUnits("20", 6),
                interval: 300,
                priceVolatility: 2
            },

            // Edge case: Uneven division
            uneven: {
                name: "Uneven Division",
                orderSize: ethers.parseUnits("100", 6) + ethers.parseUnits("7", 6), // 107 units
                sliceSize: ethers.parseUnits("20", 6), // Creates 5.35 slices
                interval: 300,
                priceVolatility: 2
            },

            // Volatile market
            volatile: {
                name: "Volatile Market",
                orderSize: ethers.parseUnits("200", 6),
                sliceSize: ethers.parseUnits("25", 6),
                interval: 180,
                priceVolatility: 10
            }
        };
    }

    /**
     * Validate order execution results
     */
    validateExecutionResults(results, expectedSlices) {
        const validations = {
            totalSlices: results.length === expectedSlices,
            allSuccessful: results.every(r => r.success),
            gasConsistency: this.checkGasConsistency(results),
            noFailures: !results.some(r => !r.success)
        };

        return {
            isValid: Object.values(validations).every(v => v),
            validations,
            summary: {
                totalSlices: results.length,
                successfulSlices: results.filter(r => r.success).length,
                failedSlices: results.filter(r => !r.success).length,
                avgGasUsed: this.calculateAverageGas(results)
            }
        };
    }

    /**
     * Check gas consistency across operations
     */
    checkGasConsistency(results, maxVariancePercent = 10) {
        const gasUsages = results.filter(r => r.success && r.gasUsed).map(r => r.gasUsed);
        
        if (gasUsages.length === 0) return false;

        const avgGas = gasUsages.reduce((a, b) => a + b, 0) / gasUsages.length;
        const maxDeviation = Math.max(...gasUsages.map(gas => Math.abs(gas - avgGas)));
        const variancePercent = (maxDeviation / avgGas) * 100;

        return variancePercent <= maxVariancePercent;
    }

    /**
     * Calculate average gas usage
     */
    calculateAverageGas(results) {
        const gasUsages = results.filter(r => r.success && r.gasUsed).map(r => r.gasUsed);
        return gasUsages.length > 0 ? Math.round(gasUsages.reduce((a, b) => a + b, 0) / gasUsages.length) : 0;
    }

    /**
     * Create network snapshot for test isolation
     */
    async createSnapshot() {
        const snapshot = await ethers.provider.send("evm_snapshot");
        this.snapshots.push(snapshot);
        return snapshot;
    }

    /**
     * Restore from network snapshot
     */
    async restoreSnapshot(snapshotId = null) {
        const snapshot = snapshotId || this.snapshots.pop();
        if (snapshot) {
            await ethers.provider.send("evm_revert", [snapshot]);
            return true;
        }
        return false;
    }

    /**
     * Setup comprehensive test environment
     */
    async setupTestEnvironment(options = {}) {
        const defaults = {
            deployContracts: true,
            setupAccounts: true,
            setupOracle: true,
            createSnapshot: true
        };

        const config = { ...defaults, ...options };
        const environment = {};

        if (config.setupAccounts) {
            environment.accounts = await this.setupTestAccounts();
        }

        if (config.deployContracts) {
            environment.contracts = await this.deployMockContracts();
        }

        if (config.setupOracle && environment.contracts) {
            environment.assetConfigs = await this.setupMockOracle(environment.contracts.mockOracle);
        }

        if (config.createSnapshot) {
            environment.snapshot = await this.createSnapshot();
        }

        return environment;
    }

    /**
     * Analyze test performance metrics
     */
    analyzePerformanceMetrics(testResults) {
        const metrics = {
            totalTests: testResults.length,
            passedTests: testResults.filter(r => r.success).length,
            failedTests: testResults.filter(r => !r.success).length,
            avgGasUsed: this.calculateAverageGas(testResults),
            gasConsistency: this.checkGasConsistency(testResults),
            totalGasUsed: testResults.reduce((sum, r) => sum + (r.gasUsed || 0), 0)
        };

        metrics.passRate = (metrics.passedTests / metrics.totalTests) * 100;
        metrics.gasEfficiency = metrics.avgGasUsed < 200000 ? 'Good' : 
                               metrics.avgGasUsed < 500000 ? 'Acceptable' : 'Poor';

        return metrics;
    }

    /**
     * Generate test report
     */
    generateTestReport(testName, results, startTime = Date.now()) {
        const endTime = Date.now();
        const duration = endTime - startTime;
        const metrics = this.analyzePerformanceMetrics(results);

        return {
            testName,
            timestamp: new Date().toISOString(),
            duration: `${duration}ms`,
            metrics,
            summary: {
                status: metrics.passRate === 100 ? 'PASSED' : 'FAILED',
                totalOperations: results.length,
                successRate: `${metrics.passRate.toFixed(2)}%`,
                avgGasUsed: metrics.avgGasUsed,
                gasEfficiency: metrics.gasEfficiency
            },
            details: results
        };
    }

    /**
     * Cleanup test environment
     */
    async cleanup() {
        // Restore all snapshots
        while (this.snapshots.length > 0) {
            await this.restoreSnapshot();
        }

        // Clear stored contracts and accounts
        this.deployedContracts.clear();
        this.testAccounts = [];
    }
}

// Export singleton instance
const testHelpers = new TestHelpers();

module.exports = { TestHelpers, testHelpers };