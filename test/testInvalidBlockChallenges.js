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

// const Web3 = require("web3");

const increaseTime = async function(addSeconds) {
    await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [addSeconds], id: 0})
    await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_mine", params: [], id: 1})
}

const {
    TxTypeFund, 
    TxTypeMerge, 
    TxTypeSplit} = require("../lib/Tx/RLPtx.js");

contract('PlasmaParent invalid block challenges', async (accounts) => {

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

    it('Transaction in block references the future', async () => {
        const tx = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 100,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 10
            }],
            [{
                amount: 10,
                to: alice
            }],
                aliceKey
        )
        let block = createBlock(1, 1, firstHash, [tx],  operatorKey)
        const reencodedTX = tx.serialize();
        const proof = block.merkleTree.getProof(0, true);
        const blockOneArray = block.serialize();
        const blockOne = Buffer.concat(blockOneArray);
        const blockOneHeader = blockOne.slice(0,137);
        const deserialization = ethUtil.rlp.decode(blockOneArray[7]);
        let lastBlockNumber = await plasma.lastBlockNumber()
        let lastBlockHash = await plasma.hashOfLastSubmittedBlock()
        lastBlockHash = await plasma.hashOfLastSubmittedBlock()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockOneHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        await testUtils.expectEvents(
            storage,
            submissionReceipt.receipt.blockNumber,
            'BlockHeaderSubmitted',
            {_blockNumber: 1, _merkleRoot: ethUtil.bufferToHex(block.header.merkleRootHash)}
        );
        let bl = await storage.blocks(1);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));
        // let root = await storage.getMerkleRoot(1);
        // assert(root = ethUtil.bufferToHex(ethUtil.hashPersonalMessage(reencodedTX)));
        submissionReceipt = await challenger.proveReferencingInvalidBlock(1, 0, ethUtil.bufferToHex(reencodedTX), ethUtil.bufferToHex(proof));
        const plasmaIsStopped = await plasma.plasmaErrorFound();
        assert(plasmaIsStopped);
    })

    it('Spend without owner signature', async () => {
        // first we fund Alice with something
        
        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 1
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 1, firstHash, [tx],  operatorKey)
        const reencodedTX = tx.serialize();
        const proof = block.merkleTree.getProof(0, true);
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let deserialization = ethUtil.rlp.decode(blockArray[7]);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        let allEvents = storage.allEvents({fromBlock: submissionReceipt.receipt.blockNumber, toBlock: submissionReceipt.receipt.blockNumber});
        let get = util.promisify(allEvents.get.bind(allEvents))
        let evs = await get()
        assert.web3Event({logs: evs}, {
            event: 'BlockHeaderSubmitted',
            args: {_blockNumber: 1,
                 _merkleRoot: ethUtil.bufferToHex(block.header.merkleRootHash)}
        }, 'The event is emitted');
        let bl = await storage.blocks(1);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));

        // than we spend an output, but now Bob signs instead of Alice

        const newHash = await plasma.hashOfLastSubmittedBlock();
        const tx2 = createTransaction(TxTypeSplit, 0, 
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
                bobKey
        )
        block = createBlock(2, 1, newHash, [tx2],  operatorKey)
        const reencodedTX2 = tx2.serialize();
        const proof2 = block.merkleTree.getProof(0, true);
        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();

        allEvents = storage.allEvents({fromBlock: submissionReceipt.receipt.blockNumber, toBlock: submissionReceipt.receipt.blockNumber});
        get = util.promisify(allEvents.get.bind(allEvents))
        evs = await get()
        assert.web3Event({logs: evs}, {
            event: 'BlockHeaderSubmitted',
            args: {_blockNumber: 2,
                 _merkleRoot: ethUtil.bufferToHex(block.header.merkleRootHash)}
        }, 'The event is emitted');

        bl = await storage.blocks(2);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));
                            // uint32 _plasmaBlockNumber, //references and proves ownership on withdraw transaction
                            // uint32 _plasmaTxNumInBlock,
                            // bytes _plasmaTransaction,
                            // bytes _merkleProof,
                            // uint32 _originatingPlasmaBlockNumber, //references and proves ownership on output of original transaction
                            // uint32 _originatingPlasmaTxNumInBlock,
                            // bytes _originatingPlasmaTransaction,
                            // bytes _originatingMerkleProof,
                            // uint256 _inputOfInterest
                            
        submissionReceipt = await challenger.proveBalanceOrOwnershipBreakingBetweenInputAndOutput(
            2, ethUtil.bufferToHex(reencodedTX2), ethUtil.bufferToHex(proof2),
            1, ethUtil.bufferToHex(reencodedTX), ethUtil.bufferToHex(proof),
            0);
        const plasmaIsStopped = await plasma.plasmaErrorFound();
        assert(plasmaIsStopped);
    })

    it('UTXO amount is not equal to input amount', async () => {
        // first we fund Alice with something
        
        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 1
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 1, firstHash, [tx],  operatorKey)
        const reencodedTX = tx.serialize();
        const proof = block.merkleTree.getProof(0, true);
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let deserialization = ethUtil.rlp.decode(blockArray[7]);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        let allEvents = storage.allEvents({fromBlock: submissionReceipt.receipt.blockNumber, toBlock: submissionReceipt.receipt.blockNumber});
        let get = util.promisify(allEvents.get.bind(allEvents))
        let evs = await get()
        assert.web3Event({logs: evs}, {
            event: 'BlockHeaderSubmitted',
            args: {_blockNumber: 1,
                 _merkleRoot: ethUtil.bufferToHex(block.header.merkleRootHash)}
        }, 'The event is emitted');
        let bl = await storage.blocks(1);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));

        // than we spend an output, but now Bob signs instead of Alice

        const newHash = await plasma.hashOfLastSubmittedBlock();
        const tx2 = createTransaction(TxTypeSplit, 0, 
            [{
                blockNumber: 1,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 1000
            }],
            [{
                amount: 1000,
                to: bob
            }],
                aliceKey
        )
        block = createBlock(2, 1, newHash, [tx2],  operatorKey)
        const reencodedTX2 = tx2.serialize();
        const proof2 = block.merkleTree.getProof(0, true);
        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();

        allEvents = storage.allEvents({fromBlock: submissionReceipt.receipt.blockNumber, toBlock: submissionReceipt.receipt.blockNumber});
        get = util.promisify(allEvents.get.bind(allEvents))
        evs = await get()
        assert.web3Event({logs: evs}, {
            event: 'BlockHeaderSubmitted',
            args: {_blockNumber: 2,
                 _merkleRoot: ethUtil.bufferToHex(block.header.merkleRootHash)}
        }, 'The event is emitted');

        bl = await storage.blocks(2);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));
                            // uint32 _plasmaBlockNumber, //references and proves ownership on withdraw transaction
                            // uint32 _plasmaTxNumInBlock,
                            // bytes _plasmaTransaction,
                            // bytes _merkleProof,
                            // uint32 _originatingPlasmaBlockNumber, //references and proves ownership on output of original transaction
                            // uint32 _originatingPlasmaTxNumInBlock,
                            // bytes _originatingPlasmaTransaction,
                            // bytes _originatingMerkleProof,
                            // uint256 _inputOfInterest
                            
        submissionReceipt = await challenger.proveBalanceOrOwnershipBreakingBetweenInputAndOutput(
            2, ethUtil.bufferToHex(reencodedTX2), ethUtil.bufferToHex(proof2),
            1, ethUtil.bufferToHex(reencodedTX), ethUtil.bufferToHex(proof),
            0);
        const plasmaIsStopped = await plasma.plasmaErrorFound();
        assert(plasmaIsStopped);
    })

    it('Double spend', async () => {
        // first we fund Alice with something
        
        let tx = createTransaction(TxTypeFund, 0, 
            [{
                blockNumber: 0,
                txNumberInBlock: 0,
                outputNumberInTransaction: 0,
                amount: 1
            }],
            [{
                amount: 100,
                to: alice
            }],
                operatorKey
        )
        let block = createBlock(1, 1, firstHash, [tx],  operatorKey)
        const reencodedTX = tx.serialize();
        const proof = block.merkleTree.getProof(0, true);
        let blockArray = block.serialize();
        let blockHeader = Buffer.concat(blockArray).slice(0,137);
        let deserialization = ethUtil.rlp.decode(blockArray[7]);
        let lastBlockNumber = await plasma.lastBlockNumber()
        assert(lastBlockNumber.toString() == "0");
        let submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();
        assert(lastBlockNumber.toString() == "1");
        let allEvents = storage.allEvents({fromBlock: submissionReceipt.receipt.blockNumber, toBlock: submissionReceipt.receipt.blockNumber});
        let get = util.promisify(allEvents.get.bind(allEvents))
        let evs = await get()
        assert.web3Event({logs: evs}, {
            event: 'BlockHeaderSubmitted',
            args: {_blockNumber: 1,
                 _merkleRoot: ethUtil.bufferToHex(block.header.merkleRootHash)}
        }, 'The event is emitted');
        let bl = await storage.blocks(1);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));

        // than we spend an output, but now Bob signs instead of Alice

        const newHash = await plasma.hashOfLastSubmittedBlock();
        const tx2 = createTransaction(TxTypeSplit, 0, 
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
        const tx3 = createTransaction(TxTypeSplit, 1, 
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
        block = createBlock(2, 2, newHash, [tx2, tx3],  operatorKey)
        const reencodedTX2 = tx2.serialize();
        const proof2 = Buffer.concat(block.merkleTree.getProof(0, true));

        const reencodedTX3 = tx3.serialize();
        const proof3 = Buffer.concat(block.merkleTree.getProof(1, true));

        blockArray = block.serialize();
        blockHeader = Buffer.concat(blockArray).slice(0,137);
        deserialization = ethUtil.rlp.decode(blockArray[7]);
        submissionReceipt = await plasma.submitBlockHeaders(ethUtil.bufferToHex(blockHeader));
        lastBlockNumber = await plasma.lastBlockNumber();

        allEvents = storage.allEvents({fromBlock: submissionReceipt.receipt.blockNumber, toBlock: submissionReceipt.receipt.blockNumber});
        get = util.promisify(allEvents.get.bind(allEvents))
        evs = await get()
        assert.web3Event({logs: evs}, {
            event: 'BlockHeaderSubmitted',
            args: {_blockNumber: 2,
                 _merkleRoot: ethUtil.bufferToHex(block.header.merkleRootHash)}
        }, 'The event is emitted');

        bl = await storage.blocks(2);
        assert(bl[2] == ethUtil.bufferToHex(block.header.merkleRootHash));
        // function proveDoubleSpend(uint32 _plasmaBlockNumber1, //references and proves transaction number 1
        //     uint32 _plasmaTxNumInBlock1,
        //     uint8 _inputNumber1,
        //     bytes _plasmaTransaction1,
        //     bytes _merkleProof1,
        //     uint32 _plasmaBlockNumber2, //references and proves transaction number 2
        //     uint32 _plasmaTxNumInBlock2,
        //     uint8 _inputNumber2,
        //     bytes _plasmaTransaction2,
        //     bytes _merkleProof2)
                            
        submissionReceipt = await challenger.proveDoubleSpend(
            2, 0, ethUtil.bufferToHex(reencodedTX2), ethUtil.bufferToHex(proof2),
            2, 0, ethUtil.bufferToHex(reencodedTX3), ethUtil.bufferToHex(proof3));
        const plasmaIsStopped = await plasma.plasmaErrorFound();
        assert(plasmaIsStopped);
    })

    it('UTXO was successfully withdrawn and than spent in Plasma', async () => {
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

        let proofObject2 = block2.getProofForTransactionByNumber(0);

        let exitDelay = await plasma.ExitDelay()
        await increaseTime(exitDelay.toNumber() + 1)

        submissionReceipt = await plasma.finalizeExits(2);

        // function proveSpendAndWithdraw(
        //     uint32 _plasmaBlockNumber, //references and proves ownership on withdraw transaction
        //     bytes _plasmaTransaction,
        //     bytes _merkleProof,
        //     bytes _originatingPlasmaTransaction,
        //     bytes _originatingMerkleProof,
        //     uint8 _inputNumber,
        //     bytes22 _partialHash)

        submissionReceipt = await challenger.proveSpendAndWithdraw(2,
            ethUtil.bufferToHex(proofObject2.tx.serialize()),
            ethUtil.bufferToHex(proofObject2.proof),
            ethUtil.bufferToHex(tx.serialize()),
            ethUtil.bufferToHex(proof),
            0,
            exitRecordHash, {from: bob});
        const plasmaIsStopped = await plasma.plasmaErrorFound();
        assert(plasmaIsStopped);

    })

})