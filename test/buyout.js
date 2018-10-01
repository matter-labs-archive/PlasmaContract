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

contract('Plasma buyout procedure', async (accounts) => {

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

    it('should send an offer and accept it', async () => {
        // deposit to prevent stopping

        const withdrawCollateral = await plasma.WithdrawCollateral();
        await plasma.deposit({from: alice, value: "100"});

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
        let submissionReceipt = await plasma.startExit(
            1, 0, ethUtil.bufferToHex(tx.serialize()), ethUtil.bufferToHex(proof),
            {from: alice, value: withdrawCollateral}
        )

        const exitRecordHash = submissionReceipt.logs[2].args._partialHash;
        const exitRecord = await plasma.exitRecords(exitRecordHash);
        const txHash = ethUtil.bufferToHex(ethUtil.sha3(proofObject.tx.serialize()))

        assert(exitRecord[0] === txHash);
        assert(exitRecord[1].toNumber() === 100)
        assert(exitRecord[2] === alice);
        assert(exitRecord[4].toString(10) === "1")
        assert(exitRecord[5].toNumber() === 0)
        assert(exitRecord[6].toNumber() === 0)
        assert(exitRecord[7] === true)
        assert(exitRecord[8] === false)

        //now lets offer a buyoyt for half of the amount
        // offerOutputBuyout(bytes22 _index)
        submissionReceipt = await plasma.offerOutputBuyout(exitRecordHash, bob, {from: bob, value: 50})
        assert(submissionReceipt.logs.length == 1);
        let offer = await plasma.exitBuyoutOffers(exitRecordHash);
        assert(offer[1] === bob);
        assert(offer[0].toString(10) === "50");
        assert(!offer[2]);

        let oldBalanceAlice = await web3.eth.getBalance(alice);
        submissionReceipt = await plasma.acceptBuyoutOffer(exitRecordHash, {from: alice, gasPrice: 0});
        let newBalanceAlice = await web3.eth.getBalance(alice);

        assert(newBalanceAlice.gt(oldBalanceAlice));

        offer = await plasma.exitBuyoutOffers(exitRecordHash);
        assert(offer[1] === bob);
        assert(offer[0].toString(10) === "50");
        assert(offer[2]);
        
        const delay = await plasma.ExitDelay();
        await increaseTime(delay.toNumber() + 1);

        let oldBalanceBob = await web3.eth.getBalance(bob);
        oldBalanceAlice = newBalanceAlice
        submissionReceipt = await plasma.finalizeExits(1, {from: operator});
        let newBalanceBob = await web3.eth.getBalance(bob);
        assert(newBalanceBob.gt(oldBalanceBob));

        newBalanceAlice = await web3.eth.getBalance(alice);
        assert(newBalanceAlice.eq(oldBalanceAlice));
    })


    it('should send a presigned offer', async () => {
        // deposit to prevent stopping

        const withdrawCollateral = await plasma.WithdrawCollateral();
        await plasma.deposit({from: alice, value: "100"});

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
        let submissionReceipt = await plasma.startExit(
            1, 0, ethUtil.bufferToHex(tx.serialize()), ethUtil.bufferToHex(proof),
            {from: alice, value: withdrawCollateral}
        )

        const exitRecordHash = submissionReceipt.logs[2].args._partialHash;
        const exitRecord = await plasma.exitRecords(exitRecordHash);
        const txHash = ethUtil.bufferToHex(ethUtil.sha3(proofObject.tx.serialize()))

        assert(exitRecord[0] === txHash);
        assert(exitRecord[1].toNumber() === 100)
        assert(exitRecord[2] === alice);
        assert(exitRecord[4].toString(10) === "1")
        assert(exitRecord[5].toNumber() === 0)
        assert(exitRecord[6].toNumber() === 0)
        assert(exitRecord[7] === true)
        assert(exitRecord[8] === false)

        //now lets offer a buyoyt for half of the amount
        // function publishPreacceptedBuyout(
        //     bytes22 _index,
        //     uint256 _amount,
        //     address _beneficiary,
        //     uint8 v,
        //     bytes32 r, 
        //     bytes32 s
        // )

        const valueBuffer = (new BN(50)).toBuffer("be", 32)
        const dataToSign = Buffer.concat([ethUtil.toBuffer(exitRecordHash), valueBuffer, ethUtil.toBuffer(bob)])
        const hashToSign = ethUtil.hashPersonalMessage(dataToSign)
        const signature = ethUtil.ecsign(hashToSign, aliceKey)
        const {v, r, s} = signature
        let oldBalanceAlice = await web3.eth.getBalance(alice);
        submissionReceipt = await plasma.publishPreacceptedBuyout(
            exitRecordHash,
            50,
            bob,
            v,
            ethUtil.bufferToHex(r),
            ethUtil.bufferToHex(s),
            {from: bob, value: 50})
        assert(submissionReceipt.logs.length == 1);
        let offer = await plasma.exitBuyoutOffers(exitRecordHash);
        assert(offer[1] === bob);
        assert(offer[0].toString(10) === "50");
        assert(offer[2]);

        let newBalanceAlice = await web3.eth.getBalance(alice);

        assert(newBalanceAlice.gt(oldBalanceAlice));
        
        const delay = await plasma.ExitDelay();
        await increaseTime(delay.toNumber() + 1);

        let oldBalanceBob = await web3.eth.getBalance(bob);
        oldBalanceAlice = newBalanceAlice
        submissionReceipt = await plasma.finalizeExits(1, {from: operator});
        let newBalanceBob = await web3.eth.getBalance(bob);
        assert(newBalanceBob.gt(oldBalanceBob));

        newBalanceAlice = await web3.eth.getBalance(alice);
        assert(newBalanceAlice.eq(oldBalanceAlice));
    })

    it('should allow returning funds for expired offer', async () => {
        // deposit to prevent stopping

        const withdrawCollateral = await plasma.WithdrawCollateral();
        await plasma.deposit({from: alice, value: "100"});

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
        let submissionReceipt = await plasma.startExit(
            1, 0, ethUtil.bufferToHex(tx.serialize()), ethUtil.bufferToHex(proof),
            {from: alice, value: withdrawCollateral}
        )

        const exitRecordHash = submissionReceipt.logs[2].args._partialHash;
        const exitRecord = await plasma.exitRecords(exitRecordHash);
        const txHash = ethUtil.bufferToHex(ethUtil.sha3(proofObject.tx.serialize()))

        assert(exitRecord[0] === txHash);
        assert(exitRecord[1].toNumber() === 100)
        assert(exitRecord[2] === alice);
        assert(exitRecord[4].toString(10) === "1")
        assert(exitRecord[5].toNumber() === 0)
        assert(exitRecord[6].toNumber() === 0)
        assert(exitRecord[7] === true)
        assert(exitRecord[8] === false)

        //now lets offer a buyoyt for half of the amount
        // offerOutputBuyout(bytes22 _index)
        submissionReceipt = await plasma.offerOutputBuyout(exitRecordHash, bob, {from: bob, value: 50})
        assert(submissionReceipt.logs.length == 1);
        let offer = await plasma.exitBuyoutOffers(exitRecordHash);
        assert(offer[1] === bob);
        assert(offer[0].toString(10) === "50");
        assert(!offer[2]);

        let oldBalanceBob = await web3.eth.getBalance(bob);
        submissionReceipt = await plasma.returnExpiredBuyoutOffer(exitRecordHash, {from: bob, gasPrice: 0});
        let newBalanceBob = await web3.eth.getBalance(bob);

        assert(newBalanceBob.gt(oldBalanceBob));
        await expectThrow(plasma.acceptBuyoutOffer(exitRecordHash, {from: alice, gasPrice: 0}));
        offer = await plasma.exitBuyoutOffers(exitRecordHash);
        assert(offer[0].toString(10) === "0");
        assert(!offer[2]);
        
        const delay = await plasma.ExitDelay();
        await increaseTime(delay.toNumber() + 1);

        let oldBalanceAlice = await web3.eth.getBalance(alice);
        oldBalanceBob = newBalanceBob
        submissionReceipt = await plasma.finalizeExits(1, {from: operator});
        let newBalanceAlice = await web3.eth.getBalance(alice);
        newBalanceBob = await web3.eth.getBalance(bob);
        assert(newBalanceBob.eq(oldBalanceBob));
        assert(newBalanceAlice.gt(oldBalanceAlice));
    })

    it('should not allow accepting for already exited transaction', async () => {
        // deposit to prevent stopping

        const withdrawCollateral = await plasma.WithdrawCollateral();
        await plasma.deposit({from: alice, value: "100"});

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
        let submissionReceipt = await plasma.startExit(
            1, 0, ethUtil.bufferToHex(tx.serialize()), ethUtil.bufferToHex(proof),
            {from: alice, value: withdrawCollateral}
        )

        const exitRecordHash = submissionReceipt.logs[2].args._partialHash;
        const exitRecord = await plasma.exitRecords(exitRecordHash);
        const txHash = ethUtil.bufferToHex(ethUtil.sha3(proofObject.tx.serialize()))

        assert(exitRecord[0] === txHash);
        assert(exitRecord[1].toNumber() === 100)
        assert(exitRecord[2] === alice);
        assert(exitRecord[4].toString(10) === "1")
        assert(exitRecord[5].toNumber() === 0)
        assert(exitRecord[6].toNumber() === 0)
        assert(exitRecord[7] === true)
        assert(exitRecord[8] === false)

        //now lets offer a buyoyt for half of the amount
        // offerOutputBuyout(bytes22 _index)
        submissionReceipt = await plasma.offerOutputBuyout(exitRecordHash, bob, {from: bob, value: 50})
        assert(submissionReceipt.logs.length == 1);
        let offer = await plasma.exitBuyoutOffers(exitRecordHash);
        assert(offer[1] === bob);
        assert(offer[0].toString(10) === "50");
        assert(!offer[2]);
        
        const delay = await plasma.ExitDelay();
        await increaseTime(delay.toNumber() + 1);

        submissionReceipt = await plasma.finalizeExits(1, {from: operator});

        await expectThrow(plasma.acceptBuyoutOffer(exitRecordHash, {from: alice, gasPrice: 0}));
    })

    it('should not allow to offer for already exited transaction', async () => {
        // deposit to prevent stopping

        const withdrawCollateral = await plasma.WithdrawCollateral();
        await plasma.deposit({from: alice, value: "100"});

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
        let submissionReceipt = await plasma.startExit(
            1, 0, ethUtil.bufferToHex(tx.serialize()), ethUtil.bufferToHex(proof),
            {from: alice, value: withdrawCollateral}
        )

        const exitRecordHash = submissionReceipt.logs[2].args._partialHash;
        const exitRecord = await plasma.exitRecords(exitRecordHash);
        const txHash = ethUtil.bufferToHex(ethUtil.sha3(proofObject.tx.serialize()))

        assert(exitRecord[0] === txHash);
        assert(exitRecord[1].toNumber() === 100)
        assert(exitRecord[2] === alice);
        assert(exitRecord[4].toString(10) === "1")
        assert(exitRecord[5].toNumber() === 0)
        assert(exitRecord[6].toNumber() === 0)
        assert(exitRecord[7] === true)
        assert(exitRecord[8] === false)

        const delay = await plasma.ExitDelay();
        await increaseTime(delay.toNumber() + 1);

        submissionReceipt = await plasma.finalizeExits(1, {from: operator});
        await expectThrow(plasma.offerOutputBuyout(exitRecordHash, bob, {from: bob, value: 50}))
    })
    
})

