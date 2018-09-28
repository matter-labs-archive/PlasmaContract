const env = process.env;

// don't load .env file in prod

module.exports = {
    networks: {
	    mainnet: {
		    provider: function() {
                if (env.NODE_ENV !== 'production') {
                    require('dotenv').load();
                }
			    let HDWalletProvider = require("truffle-hdwallet-provider");
			    return new HDWalletProvider(env.ETH_MNEMONIC, "https://mainnet.infura.io/" + env.INFURA_TOKEN, 0)
		    },
		    network_id: 1
	    },
        rinkeby: {
            provider: function() {
                if (env.NODE_ENV !== 'production') {
                    require('dotenv').load();
                }
                let WalletProvider = require("truffle-wallet-provider");
                let wallet = require('ethereumjs-wallet').fromPrivateKey(Buffer.from(env.ETH_KEY, 'hex'));
                return new WalletProvider(wallet, "https://rinkeby.infura.io/" + env.INFURA_TOKEN)
            },
            network_id: 4,
            gasPrice: 1000000000
            // gas: 7000000,
        },
	    rinkeby2: {
		    provider: function() {
                if (env.NODE_ENV !== 'production') {
                    require('dotenv').load();
                }
			    let HDWalletProvider = require("truffle-hdwallet-provider");
			    return new HDWalletProvider(env.ETH_MNEMONIC, "https://rinkeby.infura.io/" + env.INFURA_TOKEN, 0)
		    },
		    network_id: 4
	    },
        ganache: {
            host: "127.0.0.1",
            gas: 7000000,
            port: 7545,
            network_id: "*", // Match any network id,
        },
        development: {
            host: '127.0.0.1',
            gas: 7000000,
            port: 8545,
            network_id: '*' // Match any network id
        },
        cli: {
            host: '127.0.0.1',
            gas: 7000000,
            port: 9545,
            network_id: '*' // Match any network id
        }
    },
};
