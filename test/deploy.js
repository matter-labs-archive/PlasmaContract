const PlasmaParent   = artifacts.require('PlasmaParent');
const PriorityQueue  = artifacts.require('PriorityQueue');
const BlockStorage = artifacts.require("PlasmaBlockStorage");
const Challenger = artifacts.require("PlasmaChallenges");
const BuyoutProcessor = artifacts.require("PlasmaBuyoutProcessor"); 
// const LimboExitGame = artifacts.require("PlasmaExitGame");
const assert = require("assert");
const truffleContract = require("truffle-contract");
const _ = require("lodash");

console.log("Parent bytecode size = " + (PlasmaParent.bytecode.length -2)/2);
console.log("Buyouts processor bytecode size = " + (BuyoutProcessor.bytecode.length -2)/2);
console.log("Challenger bytecode size = " + (Challenger.bytecode.length -2)/2);
// console.log("Limbo exit game bytecode length = " + (LimboExitGame.bytecode.length -2)/2);

async function deploy(operator, operatorAddress) {
    const storage = await BlockStorage.new({from: operator})
    const queue  = await PriorityQueue.new({from: operator})
    const parent = await PlasmaParent.new(queue.address, storage.address, {from: operator, value: "10000000000000000000"})
    await storage.setOwner(parent.address, {from: operator})
    await queue.setOwner(parent.address, {from: operator})
    // limboExitGame = plasma
    const buyoutProcessor = await BuyoutProcessor.new({from: operator});
    const challenger = await Challenger.new({from: operator});

    await parent.allowDeposits(buyoutProcessor.address, {from: operator})
    await parent.allowChallenges(challenger.address, {from: operator});
    // await parent.allowLimboExits(limboExitGame.address, {from: operator})
    await parent.setOperator(operatorAddress, 2, {from: operator});

    const canSignBlocks = await storage.canSignBlocks(operator);
    assert(canSignBlocks);

    const buyoutProcessorAddress = await parent.buyoutProcessorContract();
    assert(buyoutProcessorAddress === buyoutProcessor.address);

    const challengesAddress = await parent.challengesContract();
    assert(challengesAddress === challenger.address);

    // const limboExitGameAddress = await plasma.limboExitContract();
    // assert(limboExitGameAddress == limboExitGame.address);

    // buyoutProcessor = BuyoutProcessor.at(plasma.address);
    // challenger = Challenger.at(plasma.address); // instead of merging the ABI
    // limboExitGame = LimboExitGame.at(plasma.address);

    let parentAbi = parent.abi;
    let buyoutAbi = buyoutProcessor.abi;
    let challengerAbi = challenger.abi;

    const mergedABI = _.uniqBy([...parentAbi, ...buyoutAbi, ...challengerAbi], a => a.name || a.type);

    const plasmaMergedContract = truffleContract({abi: mergedABI}, {gas: 4700000});
    plasmaMergedContract.setProvider(web3.currentProvider)
    plasmaMergedContract.defaults({from: operator, gas: 1000000});
    const plasma = plasmaMergedContract.at(parent.address);
    const firstHash = await plasma.hashOfLastSubmittedBlock();

    return {plasma, firstHash, queue, storage}
}

module.exports = deploy