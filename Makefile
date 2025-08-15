.PHONY: all install build test clean dev deploy docker-up docker-down help

# Default target
all: install build

# Colors for output
RED=\033[0;31m
GREEN=\033[0;32m
YELLOW=\033[1;33m
NC=\033[0m # No Color

help: ## Show this help message
	@echo "HyperCore Advanced Suite - Makefile Commands"
	@echo "============================================="
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "$(GREEN)%-20s$(NC) %s\n", $$1, $$2}'

install: ## Install all dependencies
	@echo "$(YELLOW)Installing dependencies...$(NC)"
	@echo "$(GREEN)Installing Node.js dependencies...$(NC)"
	npm install
	@echo "$(GREEN)Installing Rust dependencies...$(NC)"
	cd ../hyperliquid-txn-simulator/simulator && cargo fetch
	@echo "$(GREEN)Installing Go dependencies...$(NC)"
	cd arbitrage && go mod download
	@echo "$(GREEN)Installing RPC server dependencies...$(NC)"
	cd rpc-enhancements && npm install
	@echo "$(GREEN)✓ All dependencies installed$(NC)"

build: ## Build all components
	@echo "$(YELLOW)Building all components...$(NC)"
	@$(MAKE) build-contracts
	@$(MAKE) build-simulator
	@$(MAKE) build-arbitrage
	@$(MAKE) build-rpc
	@echo "$(GREEN)✓ All components built successfully$(NC)"

build-contracts: ## Build smart contracts
	@echo "$(GREEN)Building smart contracts...$(NC)"
	npx hardhat compile

build-simulator: ## Build Rust simulator
	@echo "$(GREEN)Building Rust simulator...$(NC)"
	cd ../hyperliquid-txn-simulator/simulator && cargo build --release

build-arbitrage: ## Build Go arbitrage bot
	@echo "$(GREEN)Building Go arbitrage bot...$(NC)"
	cd arbitrage && go build -o arbitrage-bot

build-rpc: ## Build TypeScript RPC server
	@echo "$(GREEN)Building RPC server...$(NC)"
	cd rpc-enhancements && npm run build

test: ## Run all tests
	@echo "$(YELLOW)Running tests...$(NC)"
	@$(MAKE) test-contracts
	@$(MAKE) test-simulator
	@$(MAKE) test-arbitrage
	@echo "$(GREEN)✓ All tests passed$(NC)"

test-contracts: ## Test smart contracts
	@echo "$(GREEN)Testing smart contracts...$(NC)"
	npx hardhat test

test-simulator: ## Test Rust simulator
	@echo "$(GREEN)Testing Rust simulator...$(NC)"
	cd ../hyperliquid-txn-simulator/simulator && cargo test

test-arbitrage: ## Test Go arbitrage bot
	@echo "$(GREEN)Testing Go arbitrage bot...$(NC)"
	cd arbitrage && go test ./...

dev: ## Run development environment
	@echo "$(YELLOW)Starting development environment...$(NC)"
	@trap 'echo "$(RED)Stopping development environment...$(NC)"; exit' INT; \
	$(MAKE) dev-simulator & \
	$(MAKE) dev-arbitrage & \
	$(MAKE) dev-rpc & \
	wait

dev-simulator: ## Run simulator in development mode
	@echo "$(GREEN)Starting simulator...$(NC)"
	cd ../hyperliquid-txn-simulator/simulator && cargo run

dev-arbitrage: ## Run arbitrage bot in development mode
	@echo "$(GREEN)Starting arbitrage bot...$(NC)"
	cd arbitrage && go run main.go

dev-rpc: ## Run RPC server in development mode
	@echo "$(GREEN)Starting RPC server...$(NC)"
	cd rpc-enhancements && npm run dev

deploy: ## Deploy smart contracts
	@echo "$(YELLOW)Deploying smart contracts...$(NC)"
	npx hardhat run scripts/deploy.js --network hyperliquidTestnet

deploy-mainnet: ## Deploy to mainnet (use with caution!)
	@echo "$(RED)WARNING: Deploying to mainnet!$(NC)"
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		npx hardhat run scripts/deploy.js --network hyperliquid; \
	fi

docker-up: ## Start all services with Docker Compose
	@echo "$(YELLOW)Starting Docker services...$(NC)"
	docker-compose up -d
	@echo "$(GREEN)✓ Services started$(NC)"
	@echo "$(GREEN)Simulator: http://localhost:3000$(NC)"
	@echo "$(GREEN)RPC Server: http://localhost:8545$(NC)"
	@echo "$(GREEN)Prometheus: http://localhost:9090$(NC)"
	@echo "$(GREEN)Grafana: http://localhost:3001$(NC)"

docker-down: ## Stop all Docker services
	@echo "$(YELLOW)Stopping Docker services...$(NC)"
	docker-compose down
	@echo "$(GREEN)✓ Services stopped$(NC)"

docker-logs: ## Show Docker logs
	docker-compose logs -f

clean: ## Clean build artifacts
	@echo "$(YELLOW)Cleaning build artifacts...$(NC)"
	rm -rf artifacts cache node_modules
	rm -rf ../hyperliquid-txn-simulator/simulator/target
	rm -rf arbitrage/arbitrage-bot
	rm -rf rpc-enhancements/dist
	rm -rf rpc-enhancements/node_modules
	@echo "$(GREEN)✓ Cleaned successfully$(NC)"

fmt: ## Format all code
	@echo "$(YELLOW)Formatting code...$(NC)"
	cd ../hyperliquid-txn-simulator/simulator && cargo fmt
	cd arbitrage && go fmt ./...
	npx prettier --write "**/*.{js,ts,json,sol}"
	@echo "$(GREEN)✓ Code formatted$(NC)"

lint: ## Lint all code
	@echo "$(YELLOW)Linting code...$(NC)"
	cd ../hyperliquid-txn-simulator/simulator && cargo clippy
	cd arbitrage && golangci-lint run
	npx solhint contracts/**/*.sol
	@echo "$(GREEN)✓ Linting complete$(NC)"

verify: ## Verify deployed contracts
	@echo "$(YELLOW)Verifying contracts...$(NC)"
	npx hardhat verify --network hyperliquidTestnet

benchmark: ## Run performance benchmarks
	@echo "$(YELLOW)Running benchmarks...$(NC)"
	cd ../hyperliquid-txn-simulator/simulator && cargo bench
	@echo "$(GREEN)✓ Benchmarks complete$(NC)"

monitor: ## Open monitoring dashboards
	@echo "$(GREEN)Opening monitoring dashboards...$(NC)"
	@echo "Prometheus: http://localhost:9090"
	@echo "Grafana: http://localhost:3001"
	@which open > /dev/null && open http://localhost:9090 && open http://localhost:3001 || echo "Please open the URLs manually"

status: ## Check status of all services
	@echo "$(YELLOW)Checking service status...$(NC)"
	@echo -n "Simulator: "
	@curl -s http://localhost:3000 > /dev/null && echo "$(GREEN)✓ Running$(NC)" || echo "$(RED)✗ Not running$(NC)"
	@echo -n "RPC Server: "
	@curl -s http://localhost:8545 > /dev/null && echo "$(GREEN)✓ Running$(NC)" || echo "$(RED)✗ Not running$(NC)"
	@echo -n "Redis: "
	@redis-cli ping > /dev/null 2>&1 && echo "$(GREEN)✓ Running$(NC)" || echo "$(RED)✗ Not running$(NC)"

.DEFAULT_GOAL := help