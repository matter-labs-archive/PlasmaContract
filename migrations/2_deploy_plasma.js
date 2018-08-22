const fs = require('fs');
const PlasmaParent   = artifacts.require('PlasmaParent');
const PriorityQueue  = artifacts.require('PriorityQueue');
const BlockStorage = artifacts.require("PlasmaBlockStorage");
const Challenger = artifacts.require("PlasmaChallenges");
const ExitProcessor = artifacts.require("PlasmaExitsProcessor");
const LimboExitGame = artifacts.require("PlasmaExitGame");
const assert = require('assert');
const _ = require('lodash');

const blockSignerAddress = "0x627306090abab3a6e1400e9345bc60c78a8bef57"

module.exports = function(deployer, network, accounts) {
    const operator = accounts[0];
    (async () => {
        await deployer.deploy(BlockStorage, {from: operator});
        let storage = await BlockStorage.deployed();

        await deployer.deploy(PriorityQueue, {from: operator});
        let queue = await PriorityQueue.deployed();

        await deployer.deploy(PlasmaParent, queue.address, storage.address,  {from: operator});
        let parent = await PlasmaParent.deployed();

        await storage.setOwner(parent.address,{from: operator});
        await queue.setOwner(parent.address, {from: operator});

        await deployer.deploy(ExitProcessor, queue.address, storage.address, {from: operator});
        let exitProcessor = await ExitProcessor.deployed();

        await deployer.deploy(Challenger, queue.address, storage.address, {from: operator});
        let challenger = await Challenger.deployed();

        await deployer.deploy(LimboExitGame, queue.address, storage.address, {from: operator});
        let limboExitGame = await LimboExitGame.deployed();

        // setDelegates(address _exitProcessor, address _challenger, address _limboExit) 
        await parent.setDelegates(exitProcessor.address, challenger.address, limboExitGame.address, {from: operator})
        await parent.setOperator(blockSignerAddress, 2, {from: operator});

        const canSignBlocks = await storage.canSignBlocks(blockSignerAddress);
        assert(canSignBlocks);

        // address public challengesContract;
        // address public limboExitContract;
        // address public exitProcessorContract;
        const exitProcessorAddress = await parent.exitProcessorContract();
        assert(exitProcessorAddress === exitProcessor.address);

        const limboExitsAddress = await parent.limboExitContract();
        assert(limboExitsAddress === limboExitGame.address);

        const challengesAddress = await parent.challengesContract();
        assert(challengesAddress === challenger.address);

        let parentAbi = parent.abi;
        let exitProcessorAbi = exitProcessor.abi;
        let challengerAbi = challenger.abi;
        let limboExitAbi = limboExitGame.abi;

        const mergedABI = _.uniqBy([...parentAbi, ...exitProcessorAbi, ...challengerAbi, ...limboExitAbi], a => a.name || a.type);
        // due to async contract address is not saved in not saved in json by truffle
        // so we need to generate details file from within migration
	    let details = {error: false, address: parent.address, abi: mergedABI};
	    fs.writeFileSync("build/details", JSON.stringify(details));
	    console.log('Complete. Contract address: ' + parent.address);
    })();
};
