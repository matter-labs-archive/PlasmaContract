const fs = require('fs');
const PlasmaParent   = artifacts.require('PlasmaParent');
const PriorityQueue  = artifacts.require('PriorityQueue');
const BlockStorage = artifacts.require("PlasmaBlockStorage");
const Challenger = artifacts.require("PlasmaChallenges");
const BuyoutProcessor = artifacts.require("PlasmaBuyoutProcessor");
// const LimboExitGame = artifacts.require("PlasmaLimboExitGame");
const assert = require('assert');
const _ = require('lodash');

var nonce;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

let blockSignerAddress = "0x627306090abab3a6e1400e9345bc60c78a8bef57"
let operatorsCollateral = "1000000000000000000" // 1 ETH

module.exports = function(deployer, network, accounts) {

    async function waitForNonceUpdate() {
        console.log("Waiting for nonce update")
        await sleep(60000)
        let newNonce = await getNonce(operator)
        while (newNonce <= nonce) {
            await sleep(60000)
            newNonce = await getNonce(operator)
        }
    }

    function getNonce(account) {
        return new Promise(function(resolve, reject) {
            web3.eth.getTransactionCount(account, function(error, nonce) {
                if (error !== null) {
                    reject(error)
                }
                resolve(nonce)
            })
        });
    }

    const operator = accounts[0];
    try {
        let env = process.env;
        if (env.NODE_ENV !== 'production') {
            require('dotenv').load();
        }
        const blockSignerAddressCandidate = env.BLOCK_SIGNER_ADDRESS
        if (blockSignerAddressCandidate !== undefined && blockSignerAddressCandidate !== "") {
            blockSignerAddress = blockSignerAddressCandidate;
        }
    }
    catch(error) {
        console.log(error)
    }
    console.log("Block signer = " + blockSignerAddress);
    console.log("Operator's bond = " + operatorsCollateral + " wei");

    (async () => {
        nonce = await getNonce(operator);
        await deployer.deploy(BlockStorage, {from: operator, gas: 2500000});
        let storage = await BlockStorage.deployed();
        console.log("Storage was deployed at " + storage.address);
        await waitForNonceUpdate();

        await deployer.deploy(PriorityQueue, {from: operator, gas: 1500000});
        let queue = await PriorityQueue.deployed();
        console.log("Queue was deployed at " + queue.address);
        await waitForNonceUpdate();

        await deployer.deploy(PlasmaParent, queue.address, storage.address,  {from: operator, value: operatorsCollateral});
        let parent = await PlasmaParent.deployed();
        console.log("Parent was deployed at " + parent.address);
        await waitForNonceUpdate();

        // let contractBalance = await web3.eth.getBalance(parent.address);
        // assert(contractBalance.toString(10) === operatorsCollateral);

        await storage.setOwner(parent.address, {from: operator, gas: 50000});
        console.log("Has set storage owner")
        await waitForNonceUpdate();

        await queue.setOwner(parent.address, {from: operator, gas: 50000});
        console.log("Has set queue owner")
        await waitForNonceUpdate();

        await deployer.deploy(BuyoutProcessor, {from: operator, gas: 2500000});
        let buyoutProcessor = await BuyoutProcessor.deployed();
        console.log("Buyout processor was deployed at " + buyoutProcessor.address);
        await waitForNonceUpdate();

        await deployer.deploy(Challenger, {from: operator, gas: 5500000});
        let challenger = await Challenger.deployed();
        console.log("Challenge processor was deployed at " + challenger.address);
        await waitForNonceUpdate();

        // await deployer.deploy(LimboExitGame, {from: operator});
        // let limboExitGame = await LimboExitGame.deployed();

        await parent.allowDeposits(buyoutProcessor.address, {from: operator, gas: 50000})
        await waitForNonceUpdate();

        await parent.allowChallenges(challenger.address, {from: operator, gas: 50000});
        await waitForNonceUpdate();

        // await parent.allowLimboExits(limboExitGame.address, {from: operator})
        // await waitForNonceUpdate();

        await parent.setOperator(blockSignerAddress, 2, {from: operator, gas: 50000});
        await waitForNonceUpdate();

        const canSignBlocks = await storage.canSignBlocks(blockSignerAddress);
        assert(canSignBlocks);

        const buyoutProcessorAddress = await parent.buyoutProcessorContract();
        assert(buyoutProcessorAddress === buyoutProcessor.address);

        const challengesAddress = await parent.challengesContract();
        assert(challengesAddress === challenger.address);

        // const limboExitsAddress = await parent.limboExitContract();
        // assert(limboExitsAddress === limboExitGame.address);

        let parentAbi = parent.abi;
        let buyoutAbi = buyoutProcessor.abi;
        let challengerAbi = challenger.abi;
        // let limboExitAbi = limboExitGame.abi;


        const mergedABI = _.uniqBy([...parentAbi, ...buyoutAbi, ...challengerAbi], a => a.name || a.type);

        // const mergedABI = _.uniqBy([...parentAbi, ...buyoutAbi, ...challengerAbi, ...limboExitAbi], a => a.name || a.type);
        // due to async contract address is not saved in not saved in json by truffle
        // so we need to generate details file from within migration
	    let details = {error: false, address: parent.address, abi: mergedABI};
        fs.writeFileSync("build/details" + network, JSON.stringify(details));
        let abiOnly = {abi: mergedABI}
        fs.writeFileSync("build/abi", JSON.stringify(abiOnly));
        if (fs.existsSync("/data/shared")) {
            fs.writeFileSync("/data/shared/details", JSON.stringify(details));
            fs.writeFileSync("/data/shared/abi", JSON.stringify(abiOnly));
        }
	    console.log('Complete. Contract address: ' + parent.address);
    })();
};
