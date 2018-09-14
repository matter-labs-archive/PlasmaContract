const util = require("util");
const ethUtil = require('ethereumjs-util');
// const BN = ethUtil.BN;
var BN;
const t = require('truffle-test-utils');
t.init();
const expectThrow = require("../helpers/expectThrow");
const {addresses, keys} = require("./keys");
const {createTransaction} = require("./createTransaction");
const {createBlock, createMerkleTree} = require("./createBlock");
const testUtils = require('./utils');
const deploy = require("./deploy");

const {
    TxTypeFund,
    TxTypeMerge,
    TxTypeSplit} = require("../lib/Tx/RLPtx");

// const Web3 = require("web3");

const increaseTime = async function(addSeconds) {
    await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [addSeconds], id: 0});
    await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_mine", params: [], id: 1})
};

contract('PlasmaParent', async (accounts) => {
    BN = web3.BigNumber;
    const operatorAddress = accounts[0];
    const operatorKey = keys[0];

    let queue;
    let plasma;
    let storage;
    let challenger;
    let buyoutProcessor;
    let limboExitGame;
    let firstHash;

    const operator = accounts[0];

    const alice    = addresses[2];
    const aliceKey = keys[2];
    const bob      = addresses[3];
    const bobKey = keys[3];
    
    beforeEach(async () => {
        const result = await deploy(operator, operatorAddress);
        ({plasma, firstHash, challenger, limboExitGame, buyoutProcessor, queue, storage} = result);
    })

    it('should exit from the huge block', async () => {
        const withdrawCollateral = await plasma.WithdrawCollateral();
        await buyoutProcessor.deposit({from: alice, value: "100000000000000"});

        const numToCreate = 1000;
        const allTXes = [];
        for (let i = 0; i < numToCreate; i++) {
            // transaction itself is invalid, but test is for another things
            const tx = createTransaction(TxTypeSplit, i, 
                [{
                    blockNumber: 0,
                    txNumberInBlock: i,
                    outputNumberInTransaction: 0,
                    amount: 100+i
                }],
                [{
                    amount: 100+i,
                    to: alice
                }],
                    operatorKey
            )
            allTXes.push(tx);
        }
        const block = createBlock(1, allTXes.length, firstHash, allTXes,  operatorKey)
        await testUtils.submitBlock(plasma, block);
        for (let i = 0; i < 10; i++) {
            try {
                const randomTXnum = Math.floor(Math.random() * numToCreate);
                // const rawTX = block.transactions[randomTXnum].serialize();
                // const proofObject = block.getProofForTransaction(rawTX);

                const proofObject = block.getProofForTransactionByNumber(randomTXnum);
                const {proof, tx} = proofObject;
                const submissionReceipt = await plasma.startExit(
                    1, 0, ethUtil.bufferToHex(tx.serialize()), ethUtil.bufferToHex(proof),
                    {from: alice, value: withdrawCollateral}
                )
                console.log("Single exit gas price is " + submissionReceipt.receipt.gasUsed)
                // struct ExitRecord {
                //     bytes32 transactionRef;
                //     //32 bytes
                //     uint256 amount;
                //     // 64 bytes
                //     address owner;
                //     uint64 timePublished;
                //     uint32 blockNumber;
                //     // 96 bytes
                //     uint32 transactionNumber;
                //     uint8 outputNumber;
                //     bool isValid;
                //     bool isLimbo;
                //     // 96 + 7 bytes
                // }
                const transactionPublishedEvent = submissionReceipt.logs[0]
                const txHashFromEvent = transactionPublishedEvent.args._hash;
                const txDataFromEvent = transactionPublishedEvent.args._data;
                const exitRecordHash = submissionReceipt.logs[2].args._hash;
                const exitRecord = await plasma.exitRecords(exitRecordHash);
                const txData = ethUtil.bufferToHex(tx.serialize())
                const txHash = ethUtil.bufferToHex(ethUtil.sha3(proofObject.tx.serialize()))

                assert(exitRecord[0] === txHash);
                assert(exitRecord[1].toNumber() === 100 + randomTXnum)
                assert(exitRecord[2] === alice);
                assert(exitRecord[4].toString(10) === "1")
                assert(exitRecord[5].toNumber() === randomTXnum)
                assert(exitRecord[6].toNumber() === 0)
                assert(exitRecord[7] === true)
                assert(exitRecord[8] === false)
                
                assert(txHash === txHashFromEvent);
                assert(txData === txDataFromEvent);
            } catch(e) {
                console.log(e);
                throw e;
            }
        }
    })

    it('should exit from the deposit transaction', async () => {
        const withdrawCollateral = await plasma.WithdrawCollateral();
        await buyoutProcessor.deposit({from: alice, value: "100"});

        const allTXes = [];
        const fundTX = createTransaction(TxTypeFund, 0, 
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
        allTXes.push(fundTX)
        const block = createBlock(1, allTXes.length, firstHash, allTXes,  operatorKey)
        await testUtils.submitBlock(plasma, block);

        const proofObject = block.getProofForTransactionByNumber(0);
        const {proof, tx} = proofObject;
        const submissionReceipt = await plasma.startExit(
            1, 0, ethUtil.bufferToHex(tx.serialize()), ethUtil.bufferToHex(proof),
            {from: alice, value: withdrawCollateral}
        )
        console.log("Single exit gas price for exiting a deposit transaction is " + submissionReceipt.receipt.gasUsed)
                // struct ExitRecord {
                //     bytes32 transactionRef;
                //     //32 bytes
                //     uint256 amount;
                //     // 64 bytes
                //     address owner;
                //     uint64 timePublished;
                //     uint32 blockNumber;
                //     // 96 bytes
                //     uint32 transactionNumber;
                //     uint8 outputNumber;
                //     bool isValid;
                //     bool isLimbo;
                //     // 96 + 7 bytes
                // }
        const transactionPublishedEvent = submissionReceipt.logs[0]
        const txHashFromEvent = transactionPublishedEvent.args._hash;
        const txDataFromEvent = transactionPublishedEvent.args._data;
        const exitRecordHash = submissionReceipt.logs[2].args._hash;
        const exitRecord = await plasma.exitRecords(exitRecordHash);
        const txData = ethUtil.bufferToHex(tx.serialize())
        const txHash = ethUtil.bufferToHex(ethUtil.sha3(proofObject.tx.serialize()))

        assert(exitRecord[0] === txHash);
        assert(exitRecord[1].toNumber() === 100)
        assert(exitRecord[2] === alice);
        assert(exitRecord[4].toString(10) === "1")
        assert(exitRecord[5].toNumber() === 0)
        assert(exitRecord[6].toNumber() === 0)
        assert(exitRecord[7] === true)
        assert(exitRecord[8] === false)

        assert(txHash === txHashFromEvent);
        assert(txData === txDataFromEvent);
    })

    it('should not allow exit from non-owner of the output', async () => {
        const withdrawCollateral = await plasma.WithdrawCollateral();
        await buyoutProcessor.deposit({from: alice, value: "100"});

        const allTXes = [];
        const fundTX = createTransaction(TxTypeFund, 0, 
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
        allTXes.push(fundTX)
        const block = createBlock(1, allTXes.length, firstHash, allTXes,  operatorKey)
        await testUtils.submitBlock(plasma, block);

        const proofObject = block.getProofForTransactionByNumber(0);
        const {proof, tx} = proofObject;
        await expectThrow(plasma.startExit(
            1, 0, ethUtil.bufferToHex(tx.serialize()), ethUtil.bufferToHex(proof),
            {from: bob, value: withdrawCollateral}
        ))
    })
    
    it('should exit and challenge after', async () => {
        const withdrawCollateral = await plasma.WithdrawCollateral();
        await buyoutProcessor.deposit({from: alice, value: "100"});

        const allTXes = [];
        const fundTX = createTransaction(TxTypeFund, 0, 
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
        allTXes.push(fundTX)
        const block = createBlock(1, allTXes.length, firstHash, allTXes,  operatorKey)
        await testUtils.submitBlock(plasma, block);

        let proofObject = block.getProofForTransactionByNumber(0);
        let {proof, tx} = proofObject;
        let submissionReceipt = await plasma.startExit(
            1, 0, ethUtil.bufferToHex(tx.serialize()), ethUtil.bufferToHex(proof),
            {from: alice, value: withdrawCollateral}
        )
        console.log("Single exit gas price for exiting a deposit transaction is " + submissionReceipt.receipt.gasUsed)

        const transactionPublishedEvent = submissionReceipt.logs[0]
        const txHashFromEvent = transactionPublishedEvent.args._hash;
        const txDataFromEvent = transactionPublishedEvent.args._data;
        let exitRecordHash = submissionReceipt.logs[2].args._hash;
        let exitRecord = await plasma.exitRecords(exitRecordHash);
        const txData = ethUtil.bufferToHex(tx.serialize())
        const txHash = ethUtil.bufferToHex(ethUtil.sha3(proofObject.tx.serialize()))

        assert(exitRecord[0] === txHash);
        assert(exitRecord[1].toNumber() === 100)
        assert(exitRecord[2] === alice);
        assert(exitRecord[4].toString(10) === "1")
        assert(exitRecord[5].toNumber() === 0)
        assert(exitRecord[6].toNumber() === 0)
        assert(exitRecord[7] === true)
        assert(exitRecord[8] === false)

        assert(txHash === txHashFromEvent);
        assert(txData === txDataFromEvent);

        let nextHash = await plasma.hashOfLastSubmittedBlock();
        const txToSpend = allTXes[0];
        const spendingTX = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: alice
            }],
                aliceKey
        )
        const block2 = createBlock(2, 1, nextHash, [spendingTX],  operatorKey)
        await testUtils.submitBlock(plasma, block2);

        proofObject = block2.getProofForTransactionByNumber(0);
        ({proof, tx} = proofObject);

        submissionReceipt = await plasma.challengeNormalExitByShowingExitBeingSpent(
            exitRecordHash, 2, ethUtil.bufferToHex(tx.serialize()), ethUtil.bufferToHex(proof), 0
        )

        console.log("Single challenge gas price for output being spent is " + submissionReceipt.receipt.gasUsed)

        exitRecordHash = submissionReceipt.logs[0].args._hash;
        exitRecord = await plasma.exitRecords(exitRecordHash);

        assert(exitRecord[0] === txHash);
        assert(exitRecord[1].toNumber() === 100)
        assert(exitRecord[2] === alice);
        assert(exitRecord[4].toString(10) === "1")
        assert(exitRecord[5].toNumber() === 0)
        assert(exitRecord[6].toNumber() === 0)
        assert(exitRecord[7] === false)
        assert(exitRecord[8] === false)

        assert(txHash === txHashFromEvent);
        assert(txData === txDataFromEvent);
    })

    it('should exit and challenge the input', async () => {
        const withdrawCollateral = await plasma.WithdrawCollateral();
        await buyoutProcessor.deposit({from: alice, value: "100"});

        const allTXes = [];
        const fundTX = createTransaction(TxTypeFund, 0, 
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
        allTXes.push(fundTX)
        const block = createBlock(1, allTXes.length, firstHash, allTXes,  operatorKey)
        await testUtils.submitBlock(plasma, block);

        let nextHash = await plasma.hashOfLastSubmittedBlock();
        const spendingTX = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 101
            }],
            [{
                amount: 101,
                to: alice
            }],
                aliceKey
        )
        const block2 = createBlock(2, 1, nextHash, [spendingTX],  operatorKey)
        await testUtils.submitBlock(plasma, block2);

        let proofObject = block2.getProofForTransactionByNumber(0);
        let {proof, tx} = proofObject;
        let submissionReceipt = await plasma.startExit(
            2, 0, ethUtil.bufferToHex(tx.serialize()), ethUtil.bufferToHex(proof),
            {from: alice, value: withdrawCollateral}
        )
        console.log("Single exit gas price for exiting a nondeposit transaction is " + submissionReceipt.receipt.gasUsed)

        const transactionPublishedEvent = submissionReceipt.logs[0]
        const txHashFromEvent = transactionPublishedEvent.args._hash;
        const txDataFromEvent = transactionPublishedEvent.args._data;
        let exitRecordHash = submissionReceipt.logs[2].args._hash;
        let exitRecord = await plasma.exitRecords(exitRecordHash);
        const txData = ethUtil.bufferToHex(tx.serialize())
        const txHash = ethUtil.bufferToHex(ethUtil.sha3(proofObject.tx.serialize()))

        assert(exitRecord[0] === txHash);
        assert(exitRecord[1].toNumber() === 101)
        assert(exitRecord[2] === alice);
        assert(exitRecord[4].toString(10) === "2")
        assert(exitRecord[5].toNumber() === 0)
        assert(exitRecord[6].toNumber() === 0)
        assert(exitRecord[7] === true)
        assert(exitRecord[8] === false)

        assert(txHash === txHashFromEvent);
        assert(txData === txDataFromEvent);

        let proofObject2 = block.getProofForTransactionByNumber(0);

        // function challengeNormalExitByShowingMismatchedInput(
        //     bytes _originalTransaction,
        //     uint8 _originalInputNumber,
        //     bytes32 _exitRecordHash,
        //     uint32 _plasmaBlockNumber, 
        //     bytes _plasmaTransaction,
        //     bytes _merkleProof,
        //     uint8 _outputNumber)

        submissionReceipt = await plasma.challengeNormalExitByShowingMismatchedInput(
            ethUtil.bufferToHex(tx.serialize()),
            0,
            exitRecordHash,
            1, 
            ethUtil.bufferToHex(proofObject2.tx.serialize()), 
            ethUtil.bufferToHex(proofObject2.proof), 0
        )
        console.log("Single challenge gas price for input mismatch is " + submissionReceipt.receipt.gasUsed)

        exitRecordHash = submissionReceipt.logs[0].args._hash;
        exitRecord = await plasma.exitRecords(exitRecordHash);

        assert(exitRecord[0] === txHash);
        assert(exitRecord[1].toNumber() === 101)
        assert(exitRecord[2] === alice);
        assert(exitRecord[4].toString(10) === "2")
        assert(exitRecord[5].toNumber() === 0)
        assert(exitRecord[6].toNumber() === 0)
        assert(exitRecord[7] === false)
        assert(exitRecord[8] === false)

        assert(txHash === txHashFromEvent);
        assert(txData === txDataFromEvent);
    })

    it('should exit and challenge by showing doublespent input', async () => {
        const withdrawCollateral = await plasma.WithdrawCollateral();
        await buyoutProcessor.deposit({from: alice, value: "100"});

        const allTXes = [];
        const fundTX = createTransaction(TxTypeFund, 0, 
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
        allTXes.push(fundTX)
        const block = createBlock(1, allTXes.length, firstHash, allTXes,  operatorKey)
        await testUtils.submitBlock(plasma, block);

        let nextHash = await plasma.hashOfLastSubmittedBlock();
        const spendingTX = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: alice
            }],
                aliceKey
        )
        const doubleSpendingTX = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: alice
            }],
                aliceKey
        )

        const block2 = createBlock(2, 1, nextHash, [spendingTX, doubleSpendingTX],  operatorKey)
        await testUtils.submitBlock(plasma, block2);

        let proofObject = block2.getProofForTransactionByNumber(0);
        let {proof, tx} = proofObject;
        let submissionReceipt = await plasma.startExit(
            2, 0, ethUtil.bufferToHex(tx.serialize()), ethUtil.bufferToHex(proof),
            {from: alice, value: withdrawCollateral}
        )

        const transactionPublishedEvent = submissionReceipt.logs[0]
        const txHashFromEvent = transactionPublishedEvent.args._hash;
        const txDataFromEvent = transactionPublishedEvent.args._data;
        let exitRecordHash = submissionReceipt.logs[2].args._hash;
        let exitRecord = await plasma.exitRecords(exitRecordHash);
        const txData = ethUtil.bufferToHex(tx.serialize())
        const txHash = ethUtil.bufferToHex(ethUtil.sha3(proofObject.tx.serialize()))

        assert(exitRecord[0] === txHash);
        assert(exitRecord[1].toNumber() === 100)
        assert(exitRecord[2] === alice);
        assert(exitRecord[4].toString(10) === "2")
        assert(exitRecord[5].toNumber() === 0)
        assert(exitRecord[6].toNumber() === 0)
        assert(exitRecord[7] === true)
        assert(exitRecord[8] === false)

        assert(txHash === txHashFromEvent);
        assert(txData === txDataFromEvent);

        let proofObject2 = block2.getProofForTransactionByNumber(1);

        // function challengeNormalExitByShowingAnInputDoubleSpend(
        //     bytes _originalTransaction,
        //     uint8 _originalInputNumber,
        //     bytes32 _exitRecordHash,
        //     uint32 _plasmaBlockNumber, 
        //     bytes _plasmaTransaction,
        //     bytes _merkleProof,
        //     uint8 _inputNumber)

        submissionReceipt = await plasma.challengeNormalExitByShowingAnInputDoubleSpend(
            ethUtil.bufferToHex(tx.serialize()),
            0,
            exitRecordHash,
            2, 
            ethUtil.bufferToHex(proofObject2.tx.serialize()), 
            ethUtil.bufferToHex(proofObject2.proof),
            0
        )

        console.log("Single challenge gas price for doublespent input is " + submissionReceipt.receipt.gasUsed)

        exitRecordHash = submissionReceipt.logs[0].args._hash;
        exitRecord = await plasma.exitRecords(exitRecordHash);

        assert(exitRecord[0] === txHash);
        assert(exitRecord[1].toNumber() === 100)
        assert(exitRecord[2] === alice);
        assert(exitRecord[4].toString(10) === "2")
        assert(exitRecord[5].toNumber() === 0)
        assert(exitRecord[6].toNumber() === 0)
        assert(exitRecord[7] === false)
        assert(exitRecord[8] === false)

        assert(txHash === txHashFromEvent);
        assert(txData === txDataFromEvent);
    })

});
