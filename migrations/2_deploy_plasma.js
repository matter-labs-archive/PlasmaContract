const fs = require('fs');
const PlasmaParent   = artifacts.require('PlasmaParent');
const PriorityQueue  = artifacts.require('PriorityQueue');
const BlockStorage = artifacts.require("PlasmaBlockStorage");
const Challenger = artifacts.require("PlasmaChallenges");
const BuyoutProcessor = artifacts.require("PlasmaBuyoutProcessor");
// const LimboExitGame = artifacts.require("PlasmaLimboExitGame");
const assert = require('assert');
const _ = require('lodash');

let blockSignerAddress = "0x627306090abab3a6e1400e9345bc60c78a8bef57"

module.exports = function(deployer, network, accounts) {
    
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

    (async () => {
        await deployer.deploy(BlockStorage, {from: operator});
        let storage = await BlockStorage.deployed();

        await deployer.deploy(PriorityQueue, {from: operator});
        let queue = await PriorityQueue.deployed();

        await deployer.deploy(PlasmaParent, queue.address, storage.address,  {from: operator});
        let parent = await PlasmaParent.deployed();

        await storage.setOwner(parent.address,{from: operator});
        await queue.setOwner(parent.address, {from: operator});

        await deployer.deploy(BuyoutProcessor, {from: operator});
        let buyoutProcessor = await BuyoutProcessor.deployed();

        await deployer.deploy(Challenger, {from: operator});
        let challenger = await Challenger.deployed();

        // await deployer.deploy(LimboExitGame, {from: operator});
        // let limboExitGame = await LimboExitGame.deployed();

        await parent.allowDeposits(buyoutProcessor.address, {from: operator})
        await parent.allowChallenges(challenger.address, {from: operator});
        // await parent.allowLimboExits(limboExitGame.address, {from: operator})
        await parent.setOperator(blockSignerAddress, 2, {from: operator});

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
        fs.writeFileSync("build/details", JSON.stringify(details));
        let abiOnly = {abi: mergedABI}
        fs.writeFileSync("build/abi", JSON.stringify(abiOnly));
        if (fs.existsSync("/data/shared")) {
            fs.writeFileSync("/data/shared/details", JSON.stringify(details));
            fs.writeFileSync("/data/shared/abi", JSON.stringify(abiOnly));
        }
	    console.log('Complete. Contract address: ' + parent.address);
    })();
};
