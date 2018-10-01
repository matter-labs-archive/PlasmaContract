const util = require("util");
const ethUtil = require('ethereumjs-util')
const BN = ethUtil.BN;
const t = require('truffle-test-utils')
t.init()
const expectThrow = require("../helpers/expectThrow");
const {addresses, keys} = require("./keys.js");
const {createTransaction, parseTransactionIndex} = require("./createTransaction");
const {createBlock, createMerkleTree} = require("./createBlock");
const testUtils = require('./utils');
const deploy = require("./deploy");

const increaseTime = async function(addSeconds) {
    await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [addSeconds], id: 0})
    await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_mine", params: [], id: 1})
}

const {
    TxTypeFund, 
    TxTypeMerge, 
    TxTypeSplit} = require("../lib/Tx/RLPtx.js");

contract('Plasma limbo exit procedure', async (accounts) => {
    const operatorAddress = accounts[0];
    const operatorKey = keys[0];

    let queue;
    let plasma;
    let storage;
    let firstHash;

    const operator = accounts[0];

    const alice    = addresses[2];
    const aliceKey = keys[2];
    const bob      = addresses[3];
    const bobKey = keys[3];
    
    beforeEach(async () => {
        const result = await deploy(operator, operatorAddress);
        ({plasma, firstHash, queue, storage} = result);
    })

    it('Should do a limbo exit', async () => {
        // first we fund Alice with something
        const withdrawCollateral = await plasma.WithdrawCollateral();
        await plasma.deposit({from: alice, value: "100"})
        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 0
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 1, firstHash, [tx],  operatorKey)
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        let newHash = await plasma.hashOfLastSubmittedBlock();
        // now alice transfers to bob
        tx = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: bob
            }],
                aliceKey
        )
        block = createBlock(2, 1, newHash, [tx],  operatorKey)
        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        bl = await storage.blocks(2);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));
        // now we spent from Bob back to Alice, but don't publish a block!
        newHash = await plasma.hashOfLastSubmittedBlock();
        const txLimbo = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 2,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 50,
                to: bob
            }, {
                amount: 50,
                to: alice
            }],
                bobKey
        )
    
        const reencodedTXLimbo = txLimbo.serialize();
        // no proof for it :(

        // function startLimboExit(
        //     uint8 _outputNumber,    // output being exited
        //     bytes _plasmaTransaction) // transaction itself

        // start limbo exit for an output 0
        submissionReceipt = await plasma.startLimboExit(0, ethUtil.bufferToHex(reencodedTXLimbo), {from: bob, value: withdrawCollateral});
        console.log("Starting a limbo exit requires gas = " + submissionReceipt.receipt.gasUsed)
        const exitRecordHash = submissionReceipt.logs[2].args._partialHash;
        size = await queue.currentSize();
        assert(size.toString(10) === "1");

        let oldBalanceBob = await web3.eth.getBalance(bob);

        const minimalItem = await queue.getMin();
        assert(minimalItem === exitRecordHash);

        let exitDelay = await plasma.ExitDelay()
        await increaseTime(exitDelay.toNumber() + 1)

        submissionReceipt = await plasma.finalizeExits(2);
        console.log("Finalization for one limbo exit = " + submissionReceipt.receipt.gasUsed)
        let newBalanceBob = await web3.eth.getBalance(bob);
        assert(newBalanceBob.gt(oldBalanceBob));
        let succesfulExit = await plasma.succesfulExits(exitRecordHash);
        assert(succesfulExit);
        size = await queue.currentSize();
        assert(size.toString(10) === "0");

    })

    it('Should do a joined limbo exit', async () => {
        // first we fund Alice with something
        const withdrawCollateral = await plasma.WithdrawCollateral();
        await plasma.deposit({from: alice, value: "100"})
        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 0
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 1, firstHash, [tx],  operatorKey)
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        let newHash = await plasma.hashOfLastSubmittedBlock();
        // now alice transfers to bob
        tx = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: bob
            }],
                aliceKey
        )
        block = createBlock(2, 1, newHash, [tx],  operatorKey)
        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        bl = await storage.blocks(2);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));
        // now we spent from Bob back to Alice, but don't publish a block!
        newHash = await plasma.hashOfLastSubmittedBlock();
        const txLimbo = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 2,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 50,
                to: bob
            }, {
                amount: 50,
                to: alice
            }],
                bobKey
        )
    
        const reencodedTXLimbo = txLimbo.serialize();
        // no proof for it :(

        // function startLimboExit(
        //     uint8 _outputNumber,    // output being exited
        //     bytes _plasmaTransaction) // transaction itself

        // start limbo exit for an output 0
        submissionReceipt = await plasma.startLimboExit(0, ethUtil.bufferToHex(reencodedTXLimbo), {from: bob, value: withdrawCollateral});
        console.log("Starting a limbo exit requires gas = " + submissionReceipt.receipt.gasUsed)
        const exitRecordHash = submissionReceipt.logs[2].args._partialHash;
        size = await queue.currentSize();
        assert(size.toString(10) === "1");

        const minimalItem = await queue.getMin();
        assert(minimalItem === exitRecordHash);

        let inputChallengesDelay = await plasma.LimboChallangesDelay();
        await increaseTime(inputChallengesDelay.toNumber() + 1)

        submissionReceipt = await plasma.joinLimboExit(exitRecordHash, 1, {from: alice, value: withdrawCollateral});

        let exitDelay = await plasma.ExitDelay()
        await increaseTime(exitDelay.toNumber() + 1)

        let oldBalanceBob = await web3.eth.getBalance(bob);
        let oldBalanceAlice = await web3.eth.getBalance(alice);
        submissionReceipt = await plasma.finalizeExits(2);
        console.log("Finalization for one limbo exit = " + submissionReceipt.receipt.gasUsed)
        let newBalanceBob = await web3.eth.getBalance(bob);
        assert(newBalanceBob.gt(oldBalanceBob));
        let newBalanceAlice = await web3.eth.getBalance(alice);
        assert(newBalanceAlice.gt(oldBalanceAlice));
        let succesfulExit = await plasma.succesfulExits(exitRecordHash);
        assert(succesfulExit);
        size = await queue.currentSize();
        assert(size.toString(10) === "0");

    })

    it('Should put a challenge on limbo exit and prevent exit', async () => {
        // first we fund Alice with something
        const withdrawCollateral = await plasma.WithdrawCollateral();
        await plasma.deposit({from: alice, value: "100"})
        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 0
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 1, firstHash, [tx],  operatorKey)
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        let newHash = await plasma.hashOfLastSubmittedBlock();
        // now alice transfers to bob
        tx = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: bob
            }],
                aliceKey
        )
        block = createBlock(2, 1, newHash, [tx],  operatorKey)
        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        bl = await storage.blocks(2);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));
        // now we spent from Bob back to Alice, but don't publish a block!
        newHash = await plasma.hashOfLastSubmittedBlock();
        const txLimbo = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 2,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 50,
                to: bob
            }, {
                amount: 50,
                to: alice
            }],
                bobKey
        )
    
        const reencodedTXLimbo = txLimbo.serialize();
        // no proof for it :(

        // function startLimboExit(
        //     uint8 _outputNumber,    // output being exited
        //     bytes _plasmaTransaction) // transaction itself

        // start limbo exit for an output 0
        submissionReceipt = await plasma.startLimboExit(0, ethUtil.bufferToHex(reencodedTXLimbo), {from: bob, value: withdrawCollateral});
        console.log("Starting a limbo exit requires gas = " + submissionReceipt.receipt.gasUsed)
        const exitRecordHash = submissionReceipt.logs[2].args._partialHash;
        size = await queue.currentSize();
        assert(size.toString(10) === "1");

        submissionReceipt = await plasma.putChallengeOnLimboExitInput(exitRecordHash, 0, {from: operator, value: withdrawCollateral});

        let oldBalanceBob = await web3.eth.getBalance(bob);

        const minimalItem = await queue.getMin();
        assert(minimalItem === exitRecordHash);

        let exitDelay = await plasma.ExitDelay()
        await increaseTime(exitDelay.toNumber() + 1)

        submissionReceipt = await plasma.finalizeExits(2);
        console.log("Finalization for zero limbo exit = " + submissionReceipt.receipt.gasUsed)
        let newBalanceBob = await web3.eth.getBalance(bob);
        assert(newBalanceBob.eq(oldBalanceBob));
        let succesfulExit = await plasma.succesfulExits(exitRecordHash);
        assert(!succesfulExit);
        size = await queue.currentSize();
        assert(size.toString(10) === "0");
    })

    it('Should resolve a challenge on limbo exit and exit', async () => {
        // first we fund Alice with something
        const withdrawCollateral = await plasma.WithdrawCollateral();
        await plasma.deposit({from: alice, value: "100"})
        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 0
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 1, firstHash, [tx],  operatorKey)
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        let newHash = await plasma.hashOfLastSubmittedBlock();
        // now alice transfers to bob
        tx = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: bob
            }],
                aliceKey
        )
        block = createBlock(2, 1, newHash, [tx],  operatorKey)
        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        bl = await storage.blocks(2);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));
        // now we spent from Bob back to Alice, but don't publish a block!
        newHash = await plasma.hashOfLastSubmittedBlock();
        const txLimbo = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 2,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 50,
                to: bob
            }, {
                amount: 50,
                to: alice
            }],
                bobKey
        )
    
        const reencodedTXLimbo = txLimbo.serialize();
        // no proof for it :(

        // function startLimboExit(
        //     uint8 _outputNumber,    // output being exited
        //     bytes _plasmaTransaction) // transaction itself

        // start limbo exit for an output 0
        submissionReceipt = await plasma.startLimboExit(0, ethUtil.bufferToHex(reencodedTXLimbo), {from: bob, value: withdrawCollateral});
        console.log("Starting a limbo exit requires gas = " + submissionReceipt.receipt.gasUsed)
        const exitRecordHash = submissionReceipt.logs[2].args._partialHash;
        size = await queue.currentSize();
        assert(size.toString(10) === "1");

        submissionReceipt = await plasma.putChallengeOnLimboExitInput(exitRecordHash, 0, {from: operator, value: withdrawCollateral});
        const challengeNumber = submissionReceipt.logs[0].args._challengeNumber;
        const minimalItem = await queue.getMin();
        assert(minimalItem === exitRecordHash);

        let challengeInfo = await plasma.limboExitsDataInputChallenge(exitRecordHash, challengeNumber);
        assert(challengeInfo[0] === operator);
        assert(challengeInfo[1].toString(10) === "0")
        assert(!challengeInfo[2])
        const proofObject = block.getProofForTransactionByNumber(0);
        const {proof} = proofObject;

        submissionReceipt = await plasma.resolveChallengeOnInput(
            exitRecordHash,
            challengeNumber,
            ethUtil.bufferToHex(reencodedTXLimbo),
            2,
            ethUtil.bufferToHex(tx.serialize()),
            ethUtil.bufferToHex(proof)
        )

        challengeInfo = await plasma.limboExitsDataInputChallenge(exitRecordHash, challengeNumber);
        assert(challengeInfo[0] === operator);
        assert(challengeInfo[1].toString(10) === "0")
        assert(challengeInfo[2])

        let exitDelay = await plasma.ExitDelay()
        await increaseTime(exitDelay.toNumber() + 1)

        let oldBalanceBob = await web3.eth.getBalance(bob);
        submissionReceipt = await plasma.finalizeExits(2);
        console.log("Finalization for one limbo exit = " + submissionReceipt.receipt.gasUsed)
        let newBalanceBob = await web3.eth.getBalance(bob);
        assert(newBalanceBob.gt(oldBalanceBob));
        let succesfulExit = await plasma.succesfulExits(exitRecordHash);
        assert(succesfulExit);
        size = await queue.currentSize();
        assert(size.toString(10) === "0");
    })

    it('Should completely invalidate a limbo exit on input mismatch', async () => {
        // first we fund Alice with something
        const withdrawCollateral = await plasma.WithdrawCollateral();
        await plasma.deposit({from: alice, value: "100"})
        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 0
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 1, firstHash, [tx],  operatorKey)
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        let newHash = await plasma.hashOfLastSubmittedBlock();
        // now alice transfers to bob
        tx = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 99
            }],
            [{
                amount: 99,
                to: bob
            }],
                aliceKey
        )
        block = createBlock(2, 1, newHash, [tx],  operatorKey)
        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        bl = await storage.blocks(2);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));
        // now we spent from Bob back to Alice, but don't publish a block!
        newHash = await plasma.hashOfLastSubmittedBlock();
        const txLimbo = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 2,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 50,
                to: bob
            }, {
                amount: 50,
                to: alice
            }],
                bobKey
        )
    
        const reencodedTXLimbo = txLimbo.serialize();
        // no proof for it :(

        // function startLimboExit(
        //     uint8 _outputNumber,    // output being exited
        //     bytes _plasmaTransaction) // transaction itself

        // start limbo exit for an output 0
        submissionReceipt = await plasma.startLimboExit(0, ethUtil.bufferToHex(reencodedTXLimbo), {from: bob, value: withdrawCollateral});
        console.log("Starting a limbo exit requires gas = " + submissionReceipt.receipt.gasUsed)
        const exitRecordHash = submissionReceipt.logs[2].args._partialHash;
        size = await queue.currentSize();
        assert(size.toString(10) === "1");

        let exitRecord = await plasma.exitRecords(exitRecordHash);
        const txHash = ethUtil.bufferToHex(ethUtil.sha3(reencodedTXLimbo))

        assert(exitRecord[0] === txHash);
        assert(exitRecord[1].toNumber() === 0)
        assert(exitRecord[2] === "0x0000000000000000000000000000000000000000");
        assert(exitRecord[4].toString(10) === "0")
        assert(exitRecord[5].toNumber() === 0)
        assert(exitRecord[6].toNumber() === 0)
        assert(exitRecord[7] === true)
        assert(exitRecord[8] === true)

        const proofObject = block.getProofForTransactionByNumber(0);
        const {proof} = proofObject;

        let oldBalanceAlice = await web3.eth.getBalance(alice);
        submissionReceipt = await plasma.challengeLimboExitByShowingMismatchedInput(
            exitRecordHash,
            0,
            ethUtil.bufferToHex(reencodedTXLimbo),
            2,
            ethUtil.bufferToHex(tx.serialize()),
            ethUtil.bufferToHex(proof),
            {from: alice}
        )
        let newBalanceAlice = await web3.eth.getBalance(alice);
        assert(newBalanceAlice.gt(oldBalanceAlice));

        exitRecord = await plasma.exitRecords(exitRecordHash);
        assert(exitRecord[7] === false)
        let exitDelay = await plasma.ExitDelay()
        await increaseTime(exitDelay.toNumber() + 1)

        let oldBalanceBob = await web3.eth.getBalance(bob);
        submissionReceipt = await plasma.finalizeExits(2);
        console.log("Finalization for zero limbo exit = " + submissionReceipt.receipt.gasUsed)
        let newBalanceBob = await web3.eth.getBalance(bob);
        assert(newBalanceBob.eq(oldBalanceBob));
        let succesfulExit = await plasma.succesfulExits(exitRecordHash);
        assert(!succesfulExit);
        size = await queue.currentSize();
        assert(size.toString(10) === "0");
    })

    it('Should completely invalidate a limbo exit by demonstrating inclusion', async () => {
        // first we fund Alice with something
        const withdrawCollateral = await plasma.WithdrawCollateral();
        await plasma.deposit({from: alice, value: "100"})
        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 0
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 1, firstHash, [tx],  operatorKey)
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        let newHash = await plasma.hashOfLastSubmittedBlock();
        // now alice transfers to bob
        tx = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: bob
            }],
                aliceKey
        )
        block = createBlock(2, 1, newHash, [tx],  operatorKey)
        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        bl = await storage.blocks(2);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));
        // now we spent from Bob back to Alice, but don't publish a block!
        newHash = await plasma.hashOfLastSubmittedBlock();
        const txLimbo = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 2,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 50,
                to: bob
            }, {
                amount: 50,
                to: alice
            }],
                bobKey
        )
        block = createBlock(3, 1, newHash, [txLimbo],  operatorKey)
        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        const reencodedTXLimbo = txLimbo.serialize();
        // no proof for it :(

        // function startLimboExit(
        //     uint8 _outputNumber,    // output being exited
        //     bytes _plasmaTransaction) // transaction itself

        // start limbo exit for an output 0
        submissionReceipt = await plasma.startLimboExit(0, ethUtil.bufferToHex(reencodedTXLimbo), {from: bob, value: withdrawCollateral});
        console.log("Starting a limbo exit requires gas = " + submissionReceipt.receipt.gasUsed)
        const exitRecordHash = submissionReceipt.logs[2].args._partialHash;
        size = await queue.currentSize();
        assert(size.toString(10) === "1");

        let exitRecord = await plasma.exitRecords(exitRecordHash);
        const txHash = ethUtil.bufferToHex(ethUtil.sha3(reencodedTXLimbo))

        assert(exitRecord[0] === txHash);
        assert(exitRecord[1].toNumber() === 0)
        assert(exitRecord[2] === "0x0000000000000000000000000000000000000000");
        assert(exitRecord[4].toString(10) === "0")
        assert(exitRecord[5].toNumber() === 0)
        assert(exitRecord[6].toNumber() === 0)
        assert(exitRecord[7] === true)
        assert(exitRecord[8] === true)

        const proofObject = block.getProofForTransactionByNumber(0);
        const {proof} = proofObject;
        tx = txLimbo;

        let oldBalanceAlice = await web3.eth.getBalance(alice);
        submissionReceipt = await plasma.challengeLimboExitByShowingAnInputAlreadySpent(
            exitRecordHash,
            0,
            ethUtil.bufferToHex(reencodedTXLimbo),
            3,
            ethUtil.bufferToHex(tx.serialize()),
            ethUtil.bufferToHex(proof),
            0,
            {from: alice}
        )
        let newBalanceAlice = await web3.eth.getBalance(alice);
        assert(newBalanceAlice.gt(oldBalanceAlice));
        
        exitRecord = await plasma.exitRecords(exitRecordHash);
        assert(exitRecord[7] === false)
        let exitDelay = await plasma.ExitDelay()
        await increaseTime(exitDelay.toNumber() + 1)

        let oldBalanceBob = await web3.eth.getBalance(bob);
        submissionReceipt = await plasma.finalizeExits(2);
        console.log("Finalization for zero limbo exit = " + submissionReceipt.receipt.gasUsed)
        let newBalanceBob = await web3.eth.getBalance(bob);
        assert(newBalanceBob.eq(oldBalanceBob));
        let succesfulExit = await plasma.succesfulExits(exitRecordHash);
        assert(!succesfulExit);
        size = await queue.currentSize();
        assert(size.toString(10) === "0");
    })

    it('Should collect a challenge bond on success', async () => {
        // first we fund Alice with something
        const withdrawCollateral = await plasma.WithdrawCollateral();
        await plasma.deposit({from: alice, value: "100"})
        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 0
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 1, firstHash, [tx],  operatorKey)
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        let newHash = await plasma.hashOfLastSubmittedBlock();
        // now alice transfers to bob
        tx = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: bob
            }],
                aliceKey
        )
        block = createBlock(2, 1, newHash, [tx],  operatorKey)
        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        bl = await storage.blocks(2);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));
        // now we spent from Bob back to Alice, but don't publish a block!
        newHash = await plasma.hashOfLastSubmittedBlock();
        const txLimbo = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 2,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 50,
                to: bob
            }, {
                amount: 50,
                to: alice
            }],
                bobKey
        )
    
        const reencodedTXLimbo = txLimbo.serialize();
        // no proof for it :(

        // function startLimboExit(
        //     uint8 _outputNumber,    // output being exited
        //     bytes _plasmaTransaction) // transaction itself

        // start limbo exit for an output 0
        submissionReceipt = await plasma.startLimboExit(0, ethUtil.bufferToHex(reencodedTXLimbo), {from: bob, value: withdrawCollateral});
        console.log("Starting a limbo exit requires gas = " + submissionReceipt.receipt.gasUsed)
        const exitRecordHash = submissionReceipt.logs[2].args._partialHash;
        size = await queue.currentSize();
        assert(size.toString(10) === "1");

        submissionReceipt = await plasma.putChallengeOnLimboExitInput(exitRecordHash, 0, {from: alice, value: withdrawCollateral});

        let oldBalanceBob = await web3.eth.getBalance(bob);

        const minimalItem = await queue.getMin();
        assert(minimalItem === exitRecordHash);

        let exitDelay = await plasma.ExitDelay()
        await increaseTime(exitDelay.toNumber() + 1)

        submissionReceipt = await plasma.finalizeExits(2);
        console.log("Finalization for zero limbo exit = " + submissionReceipt.receipt.gasUsed)
        let newBalanceBob = await web3.eth.getBalance(bob);
        assert(newBalanceBob.eq(oldBalanceBob));
        let succesfulExit = await plasma.succesfulExits(exitRecordHash);
        assert(!succesfulExit);
        size = await queue.currentSize();
        assert(size.toString(10) === "0");

        let oldBalanceAlice = await web3.eth.getBalance(alice);
        submissionReceipt = await plasma.collectChallengeCollateral(
            exitRecordHash,
            0,
            {from: alice, gasPrice: 0}
        )
        let newBalanceAlice = await web3.eth.getBalance(alice);
        assert(newBalanceAlice.gt(oldBalanceAlice.add(withdrawCollateral)));
        assert(newBalanceAlice.lte(oldBalanceAlice.add(withdrawCollateral).add(withdrawCollateral)));
        await expectThrow(plasma.collectChallengeCollateral(
            exitRecordHash,
            0,
            {from: alice, gasPrice: 0}
        ))
    })

})

function prettyPrint(res) {
    for (let field of res) {
        console.log(field.toString(10));
    }
}

