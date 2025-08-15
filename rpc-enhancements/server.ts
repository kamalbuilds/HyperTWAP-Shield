import express from 'express';
import { ethers } from 'ethers';
import WebSocket from 'ws';
import Redis from 'ioredis';
import { createHash } from 'crypto';

interface CustomRPCMethods {
  eth_simulateTransaction: (params: any) => Promise<any>;
  eth_getStateProof: (params: any) => Promise<any>;
  eth_traceBlock: (params: any) => Promise<any>;
  hyperliquid_getOrderBook: (params: any) => Promise<any>;
  hyperliquid_getCoreState: (params: any) => Promise<any>;
}

class EnhancedRPCServer {
  private app: express.Application;
  private provider: ethers.JsonRpcProvider;
  private redis: Redis;
  private wss: WebSocket.Server;
  private cache: Map<string, { data: any; timestamp: number }>;
  private readonly CACHE_TTL = 1000; // 1 second

  constructor() {
    this.app = express();
    this.provider = new ethers.JsonRpcProvider('https://rpc.hyperliquid.xyz/evm');
    this.redis = new Redis();
    this.cache = new Map();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware() {
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      next();
    });
  }

  private setupRoutes() {
    this.app.post('/rpc', async (req, res) => {
      const { method, params, id } = req.body;
      
      try {
        const result = await this.handleRPCMethod(method, params);
        res.json({
          jsonrpc: '2.0',
          result,
          id
        });
      } catch (error: any) {
        res.json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: error.message
          },
          id
        });
      }
    });

    this.app.post('/batch', async (req, res) => {
      const requests = req.body;
      const results = await Promise.all(
        requests.map((request: any) => 
          this.handleRPCMethod(request.method, request.params)
            .then(result => ({
              jsonrpc: '2.0',
              result,
              id: request.id
            }))
            .catch(error => ({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: error.message
              },
              id: request.id
            }))
        )
      );
      
      res.json(results);
    });
  }

  private setupWebSocket() {
    this.wss = new WebSocket.Server({ port: 8546 });
    
    this.wss.on('connection', (ws) => {
      console.log('New WebSocket connection');
      
      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message.toString());
          const result = await this.handleSubscription(data);
          ws.send(JSON.stringify(result));
        } catch (error: any) {
          ws.send(JSON.stringify({
            error: error.message
          }));
        }
      });
    });
  }

  private async handleRPCMethod(method: string, params: any): Promise<any> {
    // Check cache first
    const cacheKey = this.getCacheKey(method, params);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    let result;
    
    switch (method) {
      case 'eth_simulateTransaction':
        result = await this.simulateTransaction(params);
        break;
      
      case 'eth_getStateProof':
        result = await this.getStateProof(params);
        break;
      
      case 'eth_traceBlock':
        result = await this.traceBlock(params);
        break;
      
      case 'hyperliquid_getOrderBook':
        result = await this.getOrderBook(params);
        break;
      
      case 'hyperliquid_getCoreState':
        result = await this.getCoreState(params);
        break;
      
      default:
        // Forward to standard provider
        result = await this.provider.send(method, params);
    }
    
    this.setCache(cacheKey, result);
    return result;
  }

  private async simulateTransaction(params: any): Promise<any> {
    const [tx] = params;
    
    // Call our transaction simulator
    const response = await fetch('http://localhost:3000/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: tx.from,
        to: tx.to,
        data: tx.data || '0x',
        value: tx.value || '0x0',
        gas: parseInt(tx.gas || '0x5f5e100'),
        include_precompiles: true
      })
    });
    
    return response.json();
  }

  private async getStateProof(params: any): Promise<any> {
    const [address, storageKeys, blockNumber] = params;
    
    // Generate Merkle proof for state
    const proof = {
      address,
      accountProof: [],
      balance: '0x0',
      codeHash: '0x',
      nonce: '0x0',
      storageHash: '0x',
      storageProof: storageKeys.map((key: string) => ({
        key,
        value: '0x0',
        proof: []
      }))
    };
    
    return proof;
  }

  private async traceBlock(params: any): Promise<any> {
    const [blockNumber, options] = params;
    
    const block = await this.provider.getBlock(blockNumber);
    if (!block) {
      throw new Error('Block not found');
    }
    
    const traces = await Promise.all(
      block.transactions.map(async (txHash) => {
        const tx = await this.provider.getTransaction(txHash);
        const receipt = await this.provider.getTransactionReceipt(txHash);
        
        return {
          txHash,
          from: tx?.from,
          to: tx?.to,
          value: tx?.value.toString(),
          gas: tx?.gasLimit.toString(),
          gasUsed: receipt?.gasUsed.toString(),
          status: receipt?.status
        };
      })
    );
    
    return traces;
  }

  private async getOrderBook(params: any): Promise<any> {
    const [asset, depth] = params;
    
    // Mock order book data
    return {
      asset,
      timestamp: Date.now(),
      bids: Array(depth || 10).fill(0).map((_, i) => ({
        price: `${5000 - i * 0.1}`,
        size: `${Math.random() * 100}`
      })),
      asks: Array(depth || 10).fill(0).map((_, i) => ({
        price: `${5000 + i * 0.1}`,
        size: `${Math.random() * 100}`
      }))
    };
  }

  private async getCoreState(params: any): Promise<any> {
    const [address, stateType] = params;
    
    // Query Core state via precompiles
    const precompileAddresses = {
      spotBalance: '0x0000000000000000000000000000000000000801',
      perpsPosition: '0x0000000000000000000000000000000000000802',
      vaultEquity: '0x0000000000000000000000000000000000000805'
    };
    
    return {
      address,
      stateType,
      value: '0x0',
      timestamp: Date.now()
    };
  }

  private async handleSubscription(data: any): Promise<any> {
    const { method, params } = data;
    
    switch (method) {
      case 'eth_subscribe':
        return this.handleSubscribe(params);
      
      case 'eth_unsubscribe':
        return this.handleUnsubscribe(params);
      
      default:
        throw new Error(`Unsupported subscription method: ${method}`);
    }
  }

  private async handleSubscribe(params: any): Promise<any> {
    const [subscriptionType, options] = params;
    const subscriptionId = createHash('sha256')
      .update(`${subscriptionType}-${Date.now()}`)
      .digest('hex')
      .substring(0, 16);
    
    // Set up subscription based on type
    switch (subscriptionType) {
      case 'newHeads':
        this.subscribeToNewHeads(subscriptionId);
        break;
      
      case 'logs':
        this.subscribeToLogs(subscriptionId, options);
        break;
      
      case 'orderBook':
        this.subscribeToOrderBook(subscriptionId, options);
        break;
    }
    
    return { subscription: subscriptionId };
  }

  private async handleUnsubscribe(params: any): Promise<any> {
    const [subscriptionId] = params;
    // Clean up subscription
    return true;
  }

  private subscribeToNewHeads(subscriptionId: string) {
    this.provider.on('block', async (blockNumber) => {
      const block = await this.provider.getBlock(blockNumber);
      this.broadcastToSubscribers(subscriptionId, block);
    });
  }

  private subscribeToLogs(subscriptionId: string, filter: any) {
    this.provider.on(filter, (log) => {
      this.broadcastToSubscribers(subscriptionId, log);
    });
  }

  private subscribeToOrderBook(subscriptionId: string, options: any) {
    setInterval(async () => {
      const orderBook = await this.getOrderBook([options.asset, options.depth]);
      this.broadcastToSubscribers(subscriptionId, orderBook);
    }, 100);
  }

  private broadcastToSubscribers(subscriptionId: string, data: any) {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_subscription',
          params: {
            subscription: subscriptionId,
            result: data
          }
        }));
      }
    });
  }

  private getCacheKey(method: string, params: any): string {
    return `${method}:${JSON.stringify(params)}`;
  }

  private getFromCache(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    return null;
  }

  private setCache(key: string, data: any) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
    
    // Clean old cache entries
    if (this.cache.size > 1000) {
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      entries.slice(0, 500).forEach(([key]) => this.cache.delete(key));
    }
  }

  public start(port: number = 8545) {
    this.app.listen(port, () => {
      console.log(`Enhanced RPC server listening on port ${port}`);
      console.log(`WebSocket server listening on port 8546`);
    });
  }
}

const server = new EnhancedRPCServer();
server.start();