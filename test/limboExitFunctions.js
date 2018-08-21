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

contract('PlasmaParent limbo exit procedure', async (accounts) => {

    const operatorAddress = accounts[0];
    const operatorKey = keys[0];

    let queue;
    let plasma;
    let storage;
    let challenger;
    let exitProcessor;
    let limboExitGame;
    let firstHash;

    const operator = accounts[0];

    const alice    = addresses[2];
    const aliceKey = keys[2];
    const bob      = addresses[3];
    const bobKey = keys[3];
    
    beforeEach(async () => {
        const result = await deploy(operator, operatorAddress);
        ({plasma, firstHash, challenger, limboExitGame, exitProcessor, queue, storage} = result);
    })

    it('Should start limbo exit', async () => {
        // first we fund Alice with something
        const withdrawCollateral = await plasma.WithdrawCollateral();

        await plasma.deposit({from: alice, value: "10000000000000"})
        let totalDeposited = await plasma.totalAmountDeposited();
        assert(totalDeposited.toString(10) === "10000000000000");

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
                blockNumber: 0,
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
                amount: 100,
                to: alice
            }],
                bobKey
        )
    
        // prepare proof to publish a previous transaction
        // that makes an input into limbo
        const reencodedTXBob = tx.serialize();
        const proofBob = block.merkleTree.getProof(0, true);

        const reencodedTXLimbo = txLimbo.serialize();
        // no proof for it :(

        // function startLimboExit(
        //     uint8 _outputNumber,    // output being exited
        //     bytes _plasmaTransaction) // transaction itself

        // expect throw that exit is not possible until the previous transaction was published
        await expectThrow(limboExitGame.startLimboExit(0, ethUtil.bufferToHex(reencodedTXLimbo), {from: bob, value: withdrawCollateral.mul(2)}))

        // publish transaction from block number 2
        let callReceipt = await exitProcessor.publishTransaction.call(2, ethUtil.bufferToHex(reencodedTXBob), ethUtil.bufferToHex(proofBob));
        submissionReceipt = await exitProcessor.publishTransaction(2, ethUtil.bufferToHex(reencodedTXBob), ethUtil.bufferToHex(proofBob));

        // struct UTXO {
        //     uint160 spendingTransactionIndex;
        //     uint8 utxoStatus;
        //     bool isLinkedToLimbo;
        //     bool amountAndOwnerConfirmed;
        //     bool pendingExit;
        //     bool succesfullyWithdrawn;
        //     address collateralHolder;
        //     address originalOwner;
        //     address boughtBy;
        //     uint256 value;
        //     uint64 dateExitAllowed;
        // }

        // unspent = 1
        // spent = 2

        let limboTxHash = ethUtil.sha3(reencodedTXLimbo)

        // let input = await plasma.publishedUTXOs(submissionReceipt.logs[0].args._index);
        // assert(input[0].toNumber() === 3 * (2**32)); // spending transaction index
        // assert(input[1].toString(10) == "2") //spent
        // assert(input[2] === false); // not linked to limbo
        // assert(input[3] === false); // amount and owner are not confirmed
        // assert(input[4] === false); // is not pending exit
        // assert(input[5] === false); // is not withdrawn
        // assert(input[6] === bob); //bob holds a collateral
        // assert(input[7] === alice); //alice was actual owner
        // assert(input[8] == "0x0000000000000000000000000000000000000000") 
        // assert(input[9].toString(10) == "100") // amount

        
        // prettyPrint(input);
        let output = await plasma.publishedUTXOs(submissionReceipt.logs[1].args._index);
        assert(output[0].toNumber() === 0); // no spending index
        assert(output[1].toString(10) == "1") //unspent
        assert(output[2] === false); // not linked to limbo
        assert(output[3] === true); // amount and owner are not confirmed
        assert(output[4] === false); // is pending exit
        assert(output[5] === false); // is not withdrawn
        assert(output[6] === "0x0000000000000000000000000000000000000000"); //output collateral is not counted
        assert(output[7] === bob); // bob is UTXO owner
        assert(output[8] == "0x0000000000000000000000000000000000000000") 
        assert(output[9].toString(10) == "100") // amount
        assert((submissionReceipt.logs[0].args._index).lt(submissionReceipt.logs[1].args._index)); // input index is less than output index

        // prettyPrint(output);
        // let exitStartedEvent = submissionReceipt.logs[2]
        // assert(exitStartedEvent.args._from == bob);
        // assert(exitStartedEvent.args._priority.toString(10) == submissionReceipt.logs[0].args._index.toString(10));
        // assert(exitStartedEvent.args._index.toString(10) == submissionReceipt.logs[1].args._index.toString(10));
        // let withdrawIndexBob = submissionReceipt.logs[2].args._index;

        // struct Transaction {
        //     bool isCanonical;
        //     bool isLimbo;
        //     uint72 priority;
        //     uint8 status;
        //     uint8 transactionType;
        //     uint72[] inputIndexes;
        //     uint72[] outputIndexes;
        //     uint8[] limboOutputIndexes;
        //     uint64 datePublished;
        //     address sender;
        // }

        // now we should be able to start a limbo exit
        // limbo exit collaterals is 2*Withdraw collateral for 1 input and 1 output
        submissionReceipt = await limboExitGame.startLimboExit(0, ethUtil.bufferToHex(reencodedTXLimbo), {from: alice, value: withdrawCollateral.mul(2)});

        let limboTransactionIndex = submissionReceipt.logs[2].args._partialHash;

        let limboTransactionPartialHash = ethUtil.toBuffer(limboTransactionIndex.toString(16)).slice(0, 20) // first 20 bytes
        assert(limboTransactionPartialHash.equals(limboTxHash.slice(12)));
        let oldBalance = await web3.eth.getBalance(alice);
        let size = await queue.currentSize();
        assert(size.toString(10) === "1");
        let minimalItem = await queue.getMin();
        assert(minimalItem[0].toString(10) === "2"); // queue item type "hash"
        assert(minimalItem[1] === limboTransactionIndex);

        let limboOutput = await plasma.limboUTXOs(limboTransactionIndex);
        assert(limboOutput[0].toNumber() === 0); // no spending index
        assert(limboOutput[1].toString(10) == "1") //unspent
        assert(limboOutput[2] === true); // is linked to limbo
        assert(limboOutput[3] === true); // amount and owner are confirmed
        assert(limboOutput[4] === true); // is pending exit
        assert(limboOutput[5] === false); // not yet succesfully withdrawn
        assert(limboOutput[6] === "0x0000000000000000000000000000000000000000"); //output collateral is not counted
        assert(limboOutput[7] === alice); // alice is UTXO owner
        assert(limboOutput[8] == "0x0000000000000000000000000000000000000000"); //no buyout
        assert(limboOutput[9].toString(10) == "100") // amount

        const delay = await plasma.ExitDelay();
        await increaseTime(delay.toNumber() + 1);

        submissionReceipt = await plasma.finalizeExits(1);

        limboOutput = await plasma.limboUTXOs(limboTransactionIndex);
        assert(limboOutput[4] === true); // is pending exit
        assert(limboOutput[5] === true); // is succesfully withdrawn
        let newBalance = await web3.eth.getBalance(alice);
        assert(newBalance.gt(oldBalance));

        size = await queue.currentSize();
        assert(size.toString(10) === "0");
    })
})

function prettyPrint(res) {
    for (let field of res) {
        console.log(field.toString(10));
    }
}

