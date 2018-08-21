const TXTester = artifacts.require("TXTester");
const util = require("util");
const ethUtil = require('ethereumjs-util')
const BN = ethUtil.BN;
const t = require('truffle-test-utils')
t.init()
const expectThrow = require("../helpers/expectThrow");
const {addresses, keys} = require("./keys.js");
const {createTransaction} = require("./createTransaction");
const {createBlock, createMerkleTree} = require("./createBlock");
const {PlasmaTransactionWithSignature} = require("../lib/Tx/RLPtxWithSignature");
const testUtils = require('./utils');

// const Web3 = require("web3");

const increaseTime = async function(addSeconds) {
    await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [addSeconds], id: 0})
    await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_mine", params: [], id: 1})
}

const {
    TxTypeFund, 
    TxTypeMerge, 
    TxTypeSplit} = require("../lib/Tx/RLPtx.js");

contract('Transaction deserialization tester', async (accounts) => {

    const operatorAddress = accounts[0];
    const operatorKey = keys[0];
    let txTester;

    const operator = accounts[0];

    const alice    = addresses[2];
    const aliceKey = keys[2];
    const bob      = addresses[3];
    const bobKey = keys[3];
    
    let firstHash;

    beforeEach(async () => {
        txTester = await TXTester.new({from: operator});
    })

    it('should encode and decode the transaction locally', () => {
        const tx = createTransaction(TxTypeSplit, 100, 
            [{
                blockNumber: 1,
                txNumberInBlock: 200,
                outputNumberInTransaction: 0,
                amount: 10
            }],
            [{
                amount: 10,
                to: alice
            }],
                aliceKey
        )
        const reencodedTX = tx.serialize();
        const parsedTX = new PlasmaTransactionWithSignature(reencodedTX);
        assert(ethUtil.bufferToHex(parsedTX.from) == alice);
    })

    it('should give proper information about the TX', async () => {
        const tx = createTransaction(TxTypeSplit, 100, 
            [{
                blockNumber: 1,
                txNumberInBlock: 200,
                outputNumberInTransaction: 0,
                amount: 10
            }],
            [{
                amount: 10,
                to: alice
            }],
                aliceKey
        )
        const reencodedTX = tx.serialize();
        const info = await txTester.parseTransaction(ethUtil.bufferToHex(reencodedTX));
        const txNumberInBlock = info[0].toNumber();
        const txType = info[1].toNumber();
        const inputsLength = info[2].toNumber();
        const outputsLength = info[3].toNumber();
        const sender = info[4];
        const isWellFormed = info[5];
        assert(isWellFormed);
        assert(sender === alice);
        assert(txType === TxTypeSplit);
        assert(inputsLength === 1);
        assert(outputsLength === 1);
        // assert(txNumberInBlock === 100);
    });

    it('should give proper information about the TX input', async () => {
        const tx = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 200,
                outputNumberInTransaction: 0,
                amount: 10
            }],
            [{
                amount: 10,
                to: alice
            }],
                aliceKey
        )
        const reencodedTX = tx.serialize();
        const info = await txTester.getInputInfo(ethUtil.bufferToHex(reencodedTX), 0);
        const blockNumber = info[0].toNumber();
        const txNumberInBlock = info[1].toNumber();
        const outputNumber = info[2].toNumber();
        const amount = info[3].toString(10);
        assert(blockNumber === 1);
        // assert(txNumberInBlock === 200);
        assert(outputNumber === 0);
        assert(amount === ""+10);
    });

    it('should give proper information about the TX output', async () => {
        const tx = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 200,
                outputNumberInTransaction: 0,
                amount: 10
            }],
            [{
                amount: 10,
                to: bob
            }],
                aliceKey
        )
        const reencodedTX = tx.serialize();
        const info = await txTester.getOutputInfo(ethUtil.bufferToHex(reencodedTX), 0);
        const outputNumber = info[0].toNumber();
        const recipient = info[1];
        const amount = info[2].toString(10);
        assert(outputNumber === 0);
        assert(recipient === bob);
        assert(amount === ""+10);
    });

    it('should give proper information about the TX in block', async () => {
        const tx = createTransaction(TxTypeSplit, 100, 
            [{
                blockNumber: 1,
                txNumberInBlock: 200,
                outputNumberInTransaction: 0,
                amount: 10
            }],
            [{
                amount: 10,
                to: alice
            }],
                aliceKey
        )
        const tx2 = createTransaction(TxTypeSplit, 100, 
            [{
                blockNumber: 1,
                txNumberInBlock: 100,
                outputNumberInTransaction: 0,
                amount: 10
            }],
            [{
                amount: 10,
                to: alice
            }],
                aliceKey
        )
        const block = createBlock(2, 2, Buffer.alloc(32), [tx, tx2], operatorKey);
        const reencodedTX2 = tx2.serialize();
        let proof = block.getProofForTransaction(tx.serialize());
        let proof2 = block.getProofForTransaction(tx2.serialize());
        proof = proof.proof
        proof2 = proof2.proof
        assert(!proof2.equals(proof));
        const root = block.getMerkleHash();
        const info = await txTester.parseFromBlock(ethUtil.bufferToHex(reencodedTX2), ethUtil.bufferToHex(proof2), ethUtil.bufferToHex(root));
        const txNumberInBlock = info[0].toNumber();
        const txType = info[1].toNumber();
        const inputsLength = info[2].toNumber();
        const outputsLength = info[3].toNumber();
        const sender = info[4];
        const isWellFormed = info[5];
        assert(txNumberInBlock === 1);
        assert(isWellFormed);
        assert(sender === alice);
        assert(txType === TxTypeSplit);
        assert(inputsLength === 1);
        assert(outputsLength === 1);
    });

    it('should parse deeped block', async () => {
        const tx = createTransaction(TxTypeSplit, 100, 
            [{
                blockNumber: 1,
                txNumberInBlock: 200,
                outputNumberInTransaction: 0,
                amount: 10
            }],
            [{
                amount: 10,
                to: alice
            }],
                aliceKey
        )
        const tx2 = createTransaction(TxTypeSplit, 100, 
            [{
                blockNumber: 1,
                txNumberInBlock: 100,
                outputNumberInTransaction: 0,
                amount: 10
            }],
            [{
                amount: 10,
                to: alice
            }],
                aliceKey
        )
        const tx3 = createTransaction(TxTypeSplit, 100, 
            [{
                blockNumber: 1,
                txNumberInBlock: 300,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: alice
            }],
                aliceKey
        )
        const block = createBlock(2, 2, Buffer.alloc(32), [tx, tx2, tx3], operatorKey);
        const reencodedTX3 = tx3.serialize();
        let proof = block.getProofForTransaction(tx.serialize());
        let proof2 = block.getProofForTransaction(tx2.serialize());
        let proof3 = block.getProofForTransaction(tx3.serialize());
        proof = proof.proof
        proof2 = proof2.proof
        proof3 = proof3.proof
        assert(!proof2.equals(proof));
        const proof3copy = Buffer.concat(block.merkleTree.getProof(2, true));
        assert(Buffer(proof3copy).equals(Buffer(proof3)));
        const root = block.getMerkleHash();
        const info = await txTester.parseFromBlock(ethUtil.bufferToHex(reencodedTX3), ethUtil.bufferToHex(proof3), ethUtil.bufferToHex(root));
        console.log(ethUtil.bufferToHex(reencodedTX3));
        console.log(ethUtil.bufferToHex(proof3));
        console.log(ethUtil.bufferToHex(root));
        const txNumberInBlock = info[0].toNumber();
        const txType = info[1].toNumber();
        const inputsLength = info[2].toNumber();
        const outputsLength = info[3].toNumber();
        const sender = info[4];
        const isWellFormed = info[5];
        assert(txNumberInBlock === 2);
        assert(isWellFormed);
        assert(sender === alice);
        assert(txType === TxTypeSplit);
        assert(inputsLength === 1);
        assert(outputsLength === 1);
    });

    it('should parse deeped block 2', async () => {
        const tx = createTransaction(TxTypeSplit, 100, 
            [{
                blockNumber: 1,
                txNumberInBlock: 200,
                outputNumberInTransaction: 0,
                amount: 10
            }],
            [{
                amount: 10,
                to: alice
            }],
                aliceKey
        )
        const tx2 = createTransaction(TxTypeSplit, 100, 
            [{
                blockNumber: 1,
                txNumberInBlock: 100,
                outputNumberInTransaction: 0,
                amount: 10
            }],
            [{
                amount: 10,
                to: alice
            }],
                aliceKey
        )
        const tx3 = createTransaction(TxTypeSplit, 100, 
            [{
                blockNumber: 1,
                txNumberInBlock: 300,
                outputNumberInTransaction: 0,
                amount: 100
            }],
            [{
                amount: 100,
                to: alice
            }],
                aliceKey
        )
        const block = createBlock(2, 2, Buffer.alloc(32), [tx, tx2, tx3], operatorKey);
        const reencodedTX3 = tx3.serialize();
        let proof = block.getProofForTransaction(tx.serialize());
        let proof2 = block.getProofForTransaction(tx2.serialize());
        let proof3 = block.getProofForTransaction(tx3.serialize());
        proof = proof.proof
        proof2 = proof2.proof
        proof3 = proof3.proof
        assert(!proof2.equals(proof));
        const proof3copy = Buffer.concat(block.merkleTree.getProof(2, true));
        assert(Buffer(proof3copy).equals(Buffer(proof3)));
        const root = block.getMerkleHash();
        const info = await txTester.parseFromBlockLimited(ethUtil.bufferToHex(reencodedTX3), ethUtil.bufferToHex(proof3), ethUtil.bufferToHex(root));
        console.log(ethUtil.bufferToHex(reencodedTX3));
        console.log(ethUtil.bufferToHex(proof3));
        console.log(ethUtil.bufferToHex(root));
        const txNumberInBlock = info[1].toNumber();
        assert(info[0]);
        assert(txNumberInBlock === 2);
    });



})