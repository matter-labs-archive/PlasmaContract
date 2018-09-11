const PriorityQueue  = artifacts.require('PriorityQueue');
const util = require("util");
const ethUtil = require('ethereumjs-util')
const BN = ethUtil.BN;
const t = require('truffle-test-utils')
t.init()
const expectThrow = require("../helpers/expectThrow");
const {addresses, keys} = require("./keys.js");
const crypto = require("crypto");
const exitPartialHashSize = 22;
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
    let priorityQueue;

    const operator = accounts[0];

    const alice    = addresses[2];
    const aliceKey = keys[2];
    const bob      = addresses[3];
    const bobKey = keys[3];
    
    let firstHash;

    beforeEach(async () => {
        priorityQueue = await PriorityQueue.new({from: operator});
    })

    it('should insert one item into queue', async () => {
        let priority = new BN(1);
        let hash = ethUtil.bufferToHex(crypto.randomBytes(exitPartialHashSize));
        let size = await priorityQueue.currentSize();
        assert(size.toString(10) === "0", "queue size should be zero at deployment");
        let submissionReceipt = await priorityQueue.insert([priority], hash);
        console.log("Inserting one item to the queue gas price = " + submissionReceipt.receipt.gasUsed);
        let minimalItem = await priorityQueue.getMin();
        assert(minimalItem === hash, "inserted hash should match");
        size = await priorityQueue.currentSize();
        assert(size.toString(10) === "1", "queue size should increase");
    });

    it('should insert two items into queue', async () => {
        let priority = new BN(1);
        let hash = ethUtil.bufferToHex(crypto.randomBytes(exitPartialHashSize));
        let submissionReceipt = await priorityQueue.insert([priority], hash);
        let size = await priorityQueue.currentSize();
        assert(size.toString(10) === "1");
        priority = new BN(2);
        let anotherHash = ethUtil.bufferToHex(crypto.randomBytes(exitPartialHashSize));
        submissionReceipt = await priorityQueue.insert([priority], anotherHash);
        size = await priorityQueue.currentSize();
        assert(size.toString(10) === "2");
        let minimalItem = await priorityQueue.getMin();
        assert(minimalItem == hash);
    });

    it('should insert two items into queue with the same priority', async () => {
        let priority = new BN(1);
        let hash = ethUtil.bufferToHex(crypto.randomBytes(exitPartialHashSize));
        let submissionReceipt = await priorityQueue.insert([priority], hash);
        let size = await priorityQueue.currentSize();
        assert(size.toString(10) === "1");
        priority = new BN(1);
        let anotherHash = ethUtil.bufferToHex(crypto.randomBytes(exitPartialHashSize));
        submissionReceipt = await priorityQueue.insert([priority], anotherHash);
        size = await priorityQueue.currentSize();
        assert(size.toString(10) === "2");
        let minimalItem = await priorityQueue.getMin();
        assert(minimalItem == hash);
    });

    // it('should insert many items into queue with the same priority', async () => {
    //     let priority = (new BN(2)).ushln(192).add(new BN(1));
    //     let submissionReceipt = await priorityQueue.insert([priority]);
    //     let size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "1");
    //     priority = (new BN(1)).ushln(192).add(new BN(2));
    //     submissionReceipt = await priorityQueue.insert([priority]);
    //     size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "2");
    //     priority = (new BN(1)).ushln(192).add(new BN(3));
    //     submissionReceipt = await priorityQueue.insert([priority]);
    //     size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "3");
    //     let minimalItem = await priorityQueue.getMin();
    //     assert(minimalItem.toString(10) === "2");
    // });

    // it('should insert many items into queue with the same priority and than pop one by one', async () => {
    //     let priority = (new BN(4)).ushln(192).add(new BN(3));
    //     let submissionReceipt = await priorityQueue.insert([priority]);
    //     let size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "1");
    //     priority = (new BN(2)).ushln(192).add(new BN(2));
    //     submissionReceipt = await priorityQueue.insert([priority]);
    //     size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "2");
    //     priority = (new BN(2)).ushln(192).add(new BN(1));
    //     submissionReceipt = await priorityQueue.insert([priority]);
    //     size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "3");
    //     let minimalItem = await priorityQueue.getMin();
    //     assert(minimalItem.toString(10) === "2");
    //     let poppedMin = await priorityQueue.delMin.call();
    //     assert(poppedMin.eq(minimalItem))
    //     await priorityQueue.delMin();
    //     size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "2");
    //     minimalItem = await priorityQueue.getMin();
    //     assert(minimalItem.toString(10) === "1");
    //     poppedMin = await priorityQueue.delMin.call();
    //     assert(poppedMin.eq(minimalItem))
    //     await priorityQueue.delMin();
    //     size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "1");
    //     minimalItem = await priorityQueue.getMin();
    //     assert(minimalItem.toString(10) === "3");
    //     poppedMin = await priorityQueue.delMin.call();
    //     assert(poppedMin.eq(minimalItem))
    //     await priorityQueue.delMin();
    //     size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "0");
    //     await expectThrow(priorityQueue.delMin());
    // });


    // it('should insert many items into queue with the same priority and than pop one by one 2', async () => {
    //     let priority = (new BN(4)).ushln(192).add(new BN(3));
    //     let submissionReceipt = await priorityQueue.insert([priority]);
    //     let size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "1");
    //     priority = (new BN(2)).ushln(192).add(new BN(2));
    //     submissionReceipt = await priorityQueue.insert([priority]);
    //     size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "2");
    //     priority = (new BN(2)).ushln(192).add(new BN(1));
    //     submissionReceipt = await priorityQueue.insert([priority]);
    //     size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "3");
    //     priority = (new BN(1)).ushln(192).add(new BN(10000));
    //     submissionReceipt = await priorityQueue.insert([priority]);
    //     size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "4");
        
    //     let minimalItem = await priorityQueue.getMin();
    //     assert(minimalItem.toString(10) === "10000");
    //     let poppedMin = await priorityQueue.delMin.call();
    //     assert(poppedMin.eq(minimalItem))
    //     await priorityQueue.delMin();
    //     size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "3");
    //     minimalItem = await priorityQueue.getMin();
    //     assert(minimalItem.toString(10) === "1");
    //     poppedMin = await priorityQueue.delMin.call();
    //     assert(poppedMin.eq(minimalItem))
    //     await priorityQueue.delMin();
    //     size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "2");
    //     minimalItem = await priorityQueue.getMin();
    //     assert(minimalItem.toString(10) === "2");
    //     poppedMin = await priorityQueue.delMin.call();
    //     assert(poppedMin.eq(minimalItem))
    //     await priorityQueue.delMin();
    //     size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "1");
    //     minimalItem = await priorityQueue.getMin();
    //     assert(minimalItem.toString(10) === "3");
    //     poppedMin = await priorityQueue.delMin.call();
    //     assert(poppedMin.eq(minimalItem))
    //     await priorityQueue.delMin();
    //     await expectThrow(priorityQueue.delMin());
    // });
})