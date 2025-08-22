require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      evmVersion: "paris",
      viaIR: true
    }
  },
  networks: {
    "hyperliquid-testnet": {
      url: "https://rpc.hyperliquid-testnet.xyz/evm",
      chainId: 998,
      accounts: ["0x923f625563505ea324659d273fe88c1c4b4f25ef377fcbad1bcc64b0b5a298f8"],
      gasPrice: "auto",
      gas: "auto"
    },
    hardhat: {
      chainId: 31337
    }
  },
  etherscan: {
    apiKey: {
      "hyperliquid-testnet": "no-api-key-needed"
    },
    customChains: [
      {
        network: "hyperliquid-testnet",
        chainId: 998,
        urls: {
          apiURL: "https://explorer.hyperliquid-testnet.xyz/api",
          browserURL: "https://explorer.hyperliquid-testnet.xyz"
        }
      }
    ]
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  mocha: {
    timeout: 40000
  }
};