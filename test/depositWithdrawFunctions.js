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

contract('Deposit withdraw functions', async (accounts) => {
    BN = web3.BigNumber;
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

    it('should emit deposit event', async () => {
        const depositAmount = 42;
        // const depositedBefore = await plasma.totalAmountDeposited();
        let receipt = await plasma.deposit({from: alice, value: depositAmount});
        // const depositIndex = testUtils.depositIndex(receipt.receipt.blockNumber);
        const depositIndex = new web3.BigNumber(0);
        // const depositedAfter = await plasma.totalAmountDeposited();
        await testUtils.expectEvents(plasma, receipt.receipt.blockNumber, 'DepositEvent', {_from: alice, _amount: depositAmount, _depositIndex: depositIndex.toNumber()});
        // assert.equal(depositedAfter.toNumber(), depositedBefore.toNumber() + depositAmount, 'Deposit counter should increase');
    });

    it('should allow deposit withdraw process', async () => {
        let receipt = await plasma.deposit({from: alice, value: 314});
        // const depositIndex = testUtils.depositIndex(receipt.receipt.blockNumber);
        const depositIndex = new web3.BigNumber(0);
        const depositWithdrawCollateral = await plasma.DepositWithdrawCollateral();
        receipt = await plasma.startDepositWithdraw(depositIndex.toString(), {from: alice, value: depositWithdrawCollateral.toString()});
        await testUtils.expectEvents(plasma, receipt.receipt.blockNumber, 'DepositWithdrawStartedEvent', {_depositIndex: depositIndex.toNumber()});
    });

    it('should require bond for deposit withdraw start', async () => {
        const receipt = await plasma.deposit({from: alice, value: 314});
        // const depositIndex = testUtils.depositIndex(receipt.receipt.blockNumber);
        const depositIndex = new web3.BigNumber(0);
        const promise = plasma.startDepositWithdraw(depositIndex, {from: alice, value: 0});
        // Will also fail if contract's bond constant is set to 0
        await expectThrow(promise);
    });

    it('should not allow early deposit withdraw', async () => {
        let receipt = await plasma.deposit({from: alice, value: 314});
        const depositIndex = new web3.BigNumber(0);
        // const depositIndex = testUtils.depositIndex(receipt.receipt.blockNumber);

        const depositWithdrawCollateral = await plasma.DepositWithdrawCollateral();
        await plasma.startDepositWithdraw(depositIndex.toString(), {from: alice, value: depositWithdrawCollateral.toString()});

        const promise = plasma.finalizeDepositWithdraw(depositIndex.toString(), {from: alice});
        await expectThrow(promise);
    });

    it('should allow successful deposit withdraw', async () => {
        const depositAmount = new BN(314);
        let receipt = await plasma.deposit({from: alice, value: depositAmount.toString()});
        const depositIndex = new web3.BigNumber(0);
        // const depositIndex = testUtils.depositIndex(receipt.receipt.blockNumber);

        const depositWithdrawCollateral = await plasma.DepositWithdrawCollateral();
        await plasma.startDepositWithdraw(depositIndex.toString(), {from: alice, value: depositWithdrawCollateral.toString()});

        const delay = await plasma.DepositWithdrawDelay();
        await increaseTime(delay.toNumber() + 1);
        const balanceBefore = await web3.eth.getBalance(alice);
        // const depositedBefore = await plasma.totalAmountDeposited();
        receipt = await plasma.finalizeDepositWithdraw(depositIndex.toString(), {from: alice, gasPrice: web3.eth.gasPrice});
        // const depositedAfter = await plasma.totalAmountDeposited();
        const balanceAfter = await web3.eth.getBalance(alice);
        await testUtils.expectEvents(plasma, receipt.receipt.blockNumber, 'DepositWithdrawCompletedEvent', {_depositIndex: depositIndex.toNumber()});

        assert(balanceAfter.gt(balanceBefore));
        const expectedBalance = balanceBefore
            .add(depositAmount)
            .add(depositWithdrawCollateral)
            .sub(web3.eth.gasPrice.mul(receipt.receipt.gasUsed));
        assert.equal(balanceAfter.toString(), expectedBalance.toString(), 'Balance not equal');
        // assert.equal(depositedAfter.toString(), (depositedBefore - depositAmount).toString(), 'Deposit counter should decrease');
    });

    it('should respond to deposit withdraw challenge', async () => {
        const depositAmount = new BN(42);
        let receipt = await plasma.deposit({from: alice, value: depositAmount.toString()});
        const depositIndex = new web3.BigNumber(0);
        // const depositIndex = testUtils.depositIndex(receipt.receipt.blockNumber);

        const tx = createTransaction(TxTypeFund, 0, [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: depositIndex.toString(10)
            }], [{
                amount: depositAmount.toString(10),
                to: alice
            }],
            operatorKey
        );
        const block = createBlock(1, 1, firstHash, [tx],  operatorKey);
        await testUtils.submitBlock(plasma, block);
        const proof = block.merkleTree.getProof(0, true);

        const depositWithdrawCollateral = await plasma.DepositWithdrawCollateral();
        await plasma.startDepositWithdraw(depositIndex, {from: alice, value: depositWithdrawCollateral});

        const balanceBefore = await web3.eth.getBalance(bob);
        receipt = await plasma.challengeDepositWithdraw(depositIndex.toString(), 1, ethUtil.bufferToHex(tx.rlpEncode()), ethUtil.bufferToHex(proof), {from: bob, gasPrice: web3.eth.gasPrice});
        const balanceAfter = await web3.eth.getBalance(bob);
        await testUtils.expectEvents(plasma, receipt.receipt.blockNumber, 'DepositWithdrawChallengedEvent', {_depositIndex: depositIndex.toNumber()});

        const expectedBalance = balanceBefore
            .add(depositWithdrawCollateral)
            .sub(web3.eth.gasPrice.mul(receipt.receipt.gasUsed));
        assert.equal(balanceAfter.toString(), expectedBalance.toString(), 'Balance not equal');
    });

    it('should stop Plasma on funding without deposit', async () => {
        const depositAmount = new BN(42);
        const tx = createTransaction(TxTypeFund, 0, [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 1
            }], [{
                amount: depositAmount.toString(),
                to: alice
            }],
            operatorKey
        );
        const block = createBlock(1, 1, firstHash, [tx],  operatorKey);
        await testUtils.submitBlock(plasma, block);
        const proof = block.merkleTree.getProof(0, true);

        const balanceBefore = await web3.eth.getBalance(bob);
        const receipt = await plasma.proveInvalidDeposit(1, ethUtil.bufferToHex(tx.rlpEncode()),
            ethUtil.bufferToHex(proof), {from: bob, gasPrice: web3.eth.gasPrice});
        const balanceAfter = await web3.eth.getBalance(bob);

        assert.equal(true, await plasma.plasmaErrorFound());
        // const two = new BN(2);
        // const bond = await plasma.operatorsBond();
        assert(balanceAfter.gt(balanceBefore));
        // const expectedBalance = balanceBefore
        //     .add(bond.div(two))
        //     .sub(web3.eth.gasPrice.mul(receipt.receipt.gasUsed));
        // assert.equal(balanceAfter.toString(), expectedBalance.toString(), 'Balance not equal');
    });

    it('should stop Plasma on double funding', async () => {
        const depositAmount = new BN(42);
        let receipt = await plasma.deposit({from: alice, value: depositAmount.toString()});
        const depositIndex = new web3.BigNumber(0);
        // const depositIndex = testUtils.depositIndex(receipt.receipt.blockNumber);

        const tx1 = createTransaction(TxTypeFund, 0, [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: depositIndex.toString()
            }], [{
                amount: depositAmount.toString(),
                to: alice
            }],
            operatorKey
        );
        const tx2 = createTransaction(TxTypeFund, 1, [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: depositIndex.toString()
            }], [{
                amount: depositAmount.toString(),
                to: alice
            }],
            operatorKey
        );
        const block = createBlock(1, 1, firstHash, [tx1, tx2],  operatorKey);
        await testUtils.submitBlock(plasma, block);
        const proof1 = block.merkleTree.getProof(0, true);
        const proof2 = block.merkleTree.getProof(1, true);

        const balanceBefore = await web3.eth.getBalance(bob);
        receipt = await plasma.proveDoubleFunding(
            1, ethUtil.bufferToHex(tx1.rlpEncode()), ethUtil.bufferToHex(Buffer.concat(proof1)),
            1, ethUtil.bufferToHex(tx2.rlpEncode()), ethUtil.bufferToHex(Buffer.concat(proof2)),
            {from: bob, gasPrice: web3.eth.gasPrice});
        const balanceAfter = await web3.eth.getBalance(bob);

        assert.equal(true, await plasma.plasmaErrorFound());
        assert(balanceAfter.gt(balanceBefore));

        // const bond = await plasma.operatorsBond();
        // const expectedBalance = balanceBefore
        //     .add(bond.div(2))
        //     .sub(web3.eth.gasPrice.mul(receipt.receipt.gasUsed));
        // assert.equal(balanceAfter.toString(), expectedBalance.toString(), 'Balance not equal');
    });

});
