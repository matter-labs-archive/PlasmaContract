const PlasmaParent   = artifacts.require('PlasmaParent');
const PriorityQueue  = artifacts.require('PriorityQueue');
const BlockStorage = artifacts.require("PlasmaBlockStorage");
// const Challenger = artifacts.require("PlasmaChallenges");
const BuyoutProcessor = artifacts.require("PlasmaBuyoutProcessor"); 
// const LimboExitGame = artifacts.require("PlasmaExitGame");
const assert = require("assert");

console.log("Parent bytecode size = " + (PlasmaParent.bytecode.length -2)/2);
// console.log("Exit processor bytecode size = " + (ExitProcessor.bytecode.length -2)/2);
// console.log("Challenger bytecode size = " + (Challenger.bytecode.length -2)/2);
// console.log("Limbo exit game bytecode length = " + (LimboExitGame.bytecode.length -2)/2);

async function deploy(operator, operatorAddress) {
    let queue;
    let plasma;
    let storage;
    let challenger;
    let buyoutProcessor;
    let limboExitGame;
    let firstHash;

    storage = await BlockStorage.new({from: operator})
    queue  = await PriorityQueue.new({from: operator})
    plasma = await PlasmaParent.new(queue.address, storage.address, {from: operator, value: "10000000000000000000"})
    await storage.setOwner(plasma.address, {from: operator})
    await queue.setOwner(plasma.address, {from: operator})
    challenger = plasma
    limboExitGame = plasma
    buyoutProcessor = await BuyoutProcessor.new({from: operator});
    // challenger = await Challenger.new(queue.address, storage.address, {from: operator});
    // limboExitGame = await LimboExitGame.new(queue.address, storage.address, {from: operator});
    await plasma.setDelegates(buyoutProcessor.address, challenger.address, limboExitGame.address, {from: operator})
    await plasma.setOperator(operatorAddress, 2, {from: operator});
    const canSignBlocks = await storage.canSignBlocks(operator);
    assert(canSignBlocks);

    const buyoutProcessorAddress = await plasma.buyoutProcessorContract();
    assert(buyoutProcessorAddress == buyoutProcessor.address);

    const challengesAddress = await plasma.challengesContract();
    assert(challengesAddress == challenger.address);

    const limboExitGameAddress = await plasma.limboExitContract();
    assert(limboExitGameAddress == limboExitGame.address);

    buyoutProcessor = BuyoutProcessor.at(plasma.address);
    // challenger = Challenger.at(plasma.address); // instead of merging the ABI
    // limboExitGame = LimboExitGame.at(plasma.address);
    firstHash = await plasma.hashOfLastSubmittedBlock();

    return {plasma, firstHash, challenger, limboExitGame, buyoutProcessor, queue, storage}
}

module.exports = deploy