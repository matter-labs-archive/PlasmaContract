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

contract('Priority queue', async (accounts) => {
    let priorityQueue;

    const operator = accounts[0];

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


    // not usable for heap queue
    // it('should insert many items and find position', async () => {
    //     let maxSize = 100
    //     let mod = new BN(maxSize/2);
    //     let p;
    //     let h;
    //     for (let i = 0; i < maxSize; i++) {
    //         let priority = new BN(crypto.randomBytes(1));
    //         let hash = ethUtil.bufferToHex(crypto.randomBytes(exitPartialHashSize));
    //         await priorityQueue.insert([priority], hash);
    //         if (i == maxSize/2) {
    //             p = priority
    //             h = hash
    //         }
    //     }
    //     let size = await priorityQueue.currentSize();
    //     assert(size.toString(10) === "" + maxSize);
    //     let position = await priorityQueue.getEstimateQueuePositionForPriority([p]);
    //     let item = await priorityQueue.heapList(position)
    //     assert(item[0].toNumber() >= p.toNumber())
    //     // assert(item[0].toString(10) === p.toString(10))
    //     // assert(item[1] === h);
    // });

    it('should insert many items and pop with checking priority', async () => {
        let maxSize = 100
        for (let i = 0; i < maxSize; i++) {
            let priority = new BN(crypto.randomBytes(1));
            let hash = ethUtil.bufferToHex(crypto.randomBytes(exitPartialHashSize));
            await priorityQueue.insert([priority], hash);
        }
        let size = await priorityQueue.currentSize();
        assert(size.toString(10) === "" + maxSize);
        let prevPrior = 0
        for (let i = 0; i < maxSize; i++) {
            let item = await priorityQueue.heapList(1);
            assert(item[0].toNumber() >= prevPrior);
            prevPrior = item[0].toNumber();
            await priorityQueue.delMin()
        }
    });
})