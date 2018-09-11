pragma solidity ^0.4.24;

import {PlasmaTransactionLibrary} from "./PlasmaTransactionLibrary.sol";
import {PlasmaBlockStorageInterface} from "./PlasmaBlockStorage.sol";
import {PriorityQueueInterface} from "./PriorityQueue.sol";

contract PlasmaExitGame {
    using PlasmaTransactionLibrary for PlasmaTransactionLibrary.PlasmaTransaction;

// begining of storage declaration

    bool public plasmaErrorFound;
    uint32 public lastValidBlock;
    uint256 public operatorsBond;

    PriorityQueueInterface public exitQueue;
    PlasmaBlockStorageInterface public blockStorage;
    address public challengesContract;
    address public limboExitContract;
    address public exitProcessorContract;
    address public owner = msg.sender;

    int256 public totalAmountDeposited;
    int256 public amountPendingExit;

    uint256 public depositCounter;

    uint256 public DepositWithdrawCollateral = 50000000000000000;
    uint256 public WithdrawCollateral = 50000000000000000;
    uint256 public constant DepositWithdrawDelay = (72 hours);
    uint256 public constant InputChallangesDelay = (168 hours);
    uint256 public constant OutputChallangesDelay = (168 hours);
    uint256 public constant ExitDelay = (336 hours);

    uint256 constant TxTypeNull = 0;
    uint256 constant TxTypeSplit = 1;
    uint256 constant TxTypeMerge = 2;
    uint256 constant TxTypeFund = 4;

    // deposits

    uint8 constant DepositStatusNoRecord = 0; // no deposit
    uint8 constant DepositStatusDeposited = 1; // deposit has happened
    uint8 constant DepositStatusWithdrawStarted = 2; // user withdraws a deposit
    uint8 constant DepositStatusWithdrawCompleted = 3; // used has withdrawn a deposit
    uint8 constant DepositStatusDepositConfirmed = 4; // a transaction with a deposit was posted


    struct DepositRecord {
        address from;
        uint8 status;
        bool hasCollateral;
        uint256 amount;
        uint256 withdrawStartedAt;
    }

    event ErrorFoundEvent(uint256 indexed _lastValidBlockNumber);

    event DepositEvent(address indexed _from, uint256 indexed _amount, uint256 indexed _depositIndex);
    event DepositWithdrawStartedEvent(uint256 indexed _depositIndex);
    event DepositWithdrawChallengedEvent(uint256 indexed _depositIndex);
    event DepositWithdrawCompletedEvent(uint256 indexed _depositIndex);

    mapping(uint256 => DepositRecord) public depositRecords;
    mapping(address => uint256[]) public allDepositRecordsForUser;

    struct ExitBuyoutOffer {
        uint256 amount;
        address from;
        bool accepted;
    }

    event ExitStartedEvent(address indexed _from,
                            uint72 indexed _priority,
                            uint72 indexed _index);
    event LimboExitStartedEvent(address indexed _from,
                            uint72 indexed _priority,
                            bytes22 indexed _partialHash);
    event WithdrawBuyoutOffered(uint256 indexed _withdrawIndex,
                                address indexed _from,
                                uint256 indexed _buyoutAmount);
    event WithdrawBuyoutAccepted(uint256 indexed _withdrawIndex,
                                address indexed _from);    

    mapping(address => uint256[]) public allExitsForUser;
    mapping(uint72 => ExitBuyoutOffer) public exitBuyoutOffers;

    uint8 constant UTXOstatusNull = 0;
    uint8 constant UTXOstatusUnspent = 1;
    uint8 constant UTXOstatusSpent = 2;

    struct UTXO {
        uint160 spendingTransactionIndex;
        uint8 utxoStatus;
        bool isLinkedToLimbo;
        bool amountAndOwnerConfirmed;
        bool pendingExit;
        bool succesfullyWithdrawn;
        address collateralHolder;
        address originalOwner;
        address boughtBy;
        uint256 value;
        uint64 dateExitAllowed;
    }

    uint8 constant PublishedTXstatusNull = 0;
    uint8 constant PublishedTXstatusWaitingForInputChallenges = 1;
    uint8 constant PublishedTXstatusWaitingForOutputChallenges = 2;

    struct Transaction {
        bool isCanonical;
        bool isLimbo;
        uint72 priority;
        uint8 status;
        uint8 transactionType;
        uint72[] inputIndexes;
        uint72[] outputIndexes;
        uint8[] limboOutputIndexes;
        uint64 datePublished;
        address sender;
    }

    mapping(uint72 => UTXO) public publishedUTXOs;
    mapping(uint160 => Transaction) public publishedTransactions;
    mapping(uint160 => Transaction) public limboTransactions;
    mapping(uint176 => UTXO) public limboUTXOs;

    event InputIsPublished(uint72 indexed _index);
    event OutputIsPublished(uint72 indexed _index);
    event LimboOutputIsPublished(uint176 indexed _index);
    event TransactionIsPublished(uint64 indexed _index);
    event LimboTransactionIsPublished(uint160 indexed _index);
// end of storage declarations --------------------------- 

    constructor(address _priorityQueue, address _blockStorage) public payable {
        require(_priorityQueue != address(0));
        require(_blockStorage != address(0));
        exitQueue = PriorityQueueInterface(_priorityQueue);
        blockStorage = PlasmaBlockStorageInterface(_blockStorage);
        operatorsBond = msg.value;
    }

// ----------------------------------

// Withdraw related functions

    //references and proves ownership on output of original transaction
    function startLimboExit(
        uint8 _outputNumber,    // output being exited
        bytes _plasmaTransaction) // transaction itself
    public payable returns(bool success) {
        uint72[] memory detachedByInputs;
        uint160 transactionIndex;
        (success, detachedByInputs, transactionIndex) = publishLimboTransaction(_plasmaTransaction);
        uint256 numChallengedInsAndOuts = 0;
        uint256 i;
        for (i = 0; i < detachedByInputs.length; i++) {
            if (detachedByInputs[i] != 0) {
                numChallengedInsAndOuts++;
            } else {
                break;
            }
        }
        Transaction storage publishedTransaction = limboTransactions[transactionIndex];
        require(publishedTransaction.isCanonical);
        require(publishedTransaction.isLimbo);
        uint176 publishedOutputIndex = (uint176(transactionIndex) << 16) + uint176(publishedTransaction.limboOutputIndexes[uint256(_outputNumber)]);
        require(publishedOutputIndex != 0);
        UTXO storage utxo = limboUTXOs[publishedOutputIndex];
        require(utxo.originalOwner == msg.sender);
        require(utxo.utxoStatus == UTXOstatusUnspent);
        utxo.pendingExit = true;
        uint72 priorityModifier = publishedTransaction.priority;
        uint72 alternativeModifier = uint72(blockStorage.weekOldBlockNumber() << (32 + 8));
        if (alternativeModifier > priorityModifier) {
            priorityModifier = alternativeModifier;
        }
        publishedTransaction.priority = priorityModifier;
        require(msg.value == WithdrawCollateral*(1+publishedTransaction.inputIndexes.length));
        require(utxo.dateExitAllowed == 0);
        utxo.dateExitAllowed = uint64(block.timestamp + InputChallangesDelay + OutputChallangesDelay);
        exitQueue.insert(priorityModifier, uint8(2), bytes22(publishedOutputIndex));
        allExitsForUser[msg.sender].push(publishedOutputIndex);
        emit LimboExitStartedEvent(msg.sender, priorityModifier, bytes22(publishedOutputIndex));
        if (numChallengedInsAndOuts != 0) {
            msg.sender.transfer(WithdrawCollateral*numChallengedInsAndOuts);
        }
        return true;
    }

    function publishLimboTransaction(
        bytes _plasmaTransaction
        ) 
    public returns (bool success, uint72[] inputsAffected, uint160 transactionHash) {
        PlasmaTransactionLibrary.PlasmaTransaction memory TX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_plasmaTransaction);
        require(TX.isWellFormed);
        require(TX.txType == TxTypeSplit || TX.txType == TxTypeMerge);
        transactionHash = uint160(keccak256(_plasmaTransaction));
        Transaction storage publishedTransaction = limboTransactions[transactionHash];
        require(publishedTransaction.status == PublishedTXstatusNull, "There is hash collision on limbo exit");
        publishedTransaction.sender = TX.sender;
        publishedTransaction.datePublished = uint64(block.timestamp);
        publishedTransaction.transactionType = TX.txType;
        publishedTransaction.isLimbo = true;
        (publishedTransaction, inputsAffected) = workOnInputs(publishedTransaction, TX, transactionHash);
        require(publishedTransaction.isCanonical, "Published exit transaction is not canonocal");
        // At this point there either happened a revert(), or all the inputs are have matched, so create outputs
        publishedTransaction = createLimboOutputs(publishedTransaction, TX, transactionHash);
        success = true;
        return;
    }

    // /**
    //     @param publishedTransaction Limbo exit transaciton storage reference
    //     @param TX parsed transaction
    //     @param publishedTransactionIndex uint160 index in published limbo transactions

    //     @return Limbo exit transaction storage reference
    //     logic is in principle the following: check that previously there were published
    //     some outputs (UTXOs) that are used as inputs for this transaction. Those are (yet) marked as unspent at least, and ownership and amounts match
    //  */

    // function checkInputs(
    //     Transaction storage publishedTransaction,
    //     PlasmaTransactionLibrary.PlasmaTransaction memory TX,
    //     uint160 publishedTransactionIndex)
    // internal returns(Transaction storage _publishedTransaction) {
    //     require(publishedTransaction.status == PublishedTXstatusNull, "Limbo exit transaction record is not empty");
    //     uint72[] memory scratchSpace = new uint72[](4);
    //     UTXO memory utxo;
    //     PlasmaTransactionLibrary.TransactionInput memory txInput;
    //     // for every input check that it was never consumed by other input
    //     // check if an UTXO was already posted, that owner and amount match
    //     for (scratchSpace[2] = 0; scratchSpace[2] < TX.inputs.length; scratchSpace[2]++) { 
    //         txInput = TX.inputs[scratchSpace[2]];
    //         scratchSpace[0] = PlasmaTransactionLibrary.makeInputOrOutputIndex(txInput.blockNumber, txInput.txNumberInBlock, txInput.outputNumberInTX); // utxo index being refered
    //         utxo = publishedUTXOs[scratchSpace[0]];
    //         require(utxo.amountAndOwnerConfirmed, "UTXO spent by limbo exit should have been published");
    //         require(utxo.originalOwner == TX.sender && utxo.value == txInput.amount, "UTXO owner and amount should match the published limbo transaction");
    //         require(utxo.spendingTransactionIndex == 0, "UTXO should have not been spent yet");
    //         require(!utxo.succesfullyWithdrawn, "UTXO should have not been withdrawn");
    //         utxo.pendingExit = false; // we expect user not to do strange things like start an exit and then publish a limbo exit on top of it...
    //         utxo.spendingTransactionIndex = publishedTransactionIndex;
    //         utxo.isLinkedToLimbo = publishedTransaction.isLimbo;
    //         utxo.utxoStatus = UTXOstatusSpent;
    //         utxo.collateralHolder = msg.sender;
    //         publishedTransaction.inputIndexes.push(scratchSpace[0]);
    //         if (scratchSpace[1] == 0) { // set priority anyway
    //             scratchSpace[1] = scratchSpace[0];
    //         } else if (scratchSpace[1] < scratchSpace[0]) { // transaction's inverse priority (so lower the better) 
    //             scratchSpace[1] = scratchSpace[0]; // is the index of the YOUNGEST input (so with the HIGHEST block || tx || output number)
    //         }
    //         publishedUTXOs[scratchSpace[0]] = utxo;
    //         publishedTransaction.inputIndexes.push(scratchSpace[0]);
    //     } 
    //     publishedTransaction.isCanonical = true;
    //     publishedTransaction.priority = scratchSpace[1];
    //     publishedTransaction.status = PublishedTXstatusWaitingForInputChallenges;
    //     return publishedTransaction;
    // }

        /**
        @param publishedTransaction Limbo exit transaciton storage reference
        @param TX parsed transaction
        @param publishedTransactionIndex uint160 index in published limbo transactions

        @return Limbo exit transaction storage reference and array of challenged transactions
        logic is in principle the following: check that previously there were published
        some outputs (UTXOs) that are used as inputs for this transaction. Those are (yet) marked as unspent at least, and ownership and amounts match
     */

    function workOnInputs(
        Transaction storage publishedTransaction,
        PlasmaTransactionLibrary.PlasmaTransaction memory TX,
        uint160 publishedTransactionIndex)
    internal returns(Transaction storage _publishedTransaction, uint72[] memory detachedInputs) {
        require(publishedTransaction.status == PublishedTXstatusNull, "Should publish a fresh transaction");
        uint72[] memory scratchSpace = new uint72[](4);
        detachedInputs = new uint72[](TX.inputs.length);
        bool clashOnTheInput;
        bool transactionIsNonCanonical;
        UTXO memory utxo;
        PlasmaTransactionLibrary.TransactionInput memory txInput;
        // for every input check that it was never consumed by other input
        // simultaneously check if an UTXO was already posted, that owner and amount match
        for (scratchSpace[2] = 0; scratchSpace[2] < TX.inputs.length; scratchSpace[2]++) { 
            txInput = TX.inputs[scratchSpace[2]];
            scratchSpace[0] = PlasmaTransactionLibrary.makeInputOrOutputIndex(txInput.blockNumber, txInput.txNumberInBlock, txInput.outputNumberInTX); // utxo index being refered
            utxo = publishedUTXOs[scratchSpace[0]];
            require(utxo.amountAndOwnerConfirmed); // this utxo was already once published
            require(utxo.originalOwner == TX.sender && utxo.value == txInput.amount);
            if (utxo.spendingTransactionIndex == 0) { 
                // this utxo was published and never spent
                require(!utxo.succesfullyWithdrawn); // should not have been already withdrawn
                utxo.pendingExit = false; // we expect user to NEVER publish and exit and then publish limbo exit on this UTXO
                utxo.spendingTransactionIndex = publishedTransactionIndex;
                utxo.isLinkedToLimbo = publishedTransaction.isLimbo;
                utxo.utxoStatus = UTXOstatusSpent;
                utxo.collateralHolder = msg.sender;
                // publishedTransaction.inputIndexes.push(scratchSpace[0]);
            } else {// was spent, check priorities and displace after we determine the full priority
                clashOnTheInput = true;
            }
            if (scratchSpace[1] == 0) { // set priority anyway
                scratchSpace[1] = scratchSpace[0];
            } else if (scratchSpace[1] < scratchSpace[0]) { // transaction's inverse priority (so lower the better) 
                scratchSpace[1] = scratchSpace[0]; // is the index of the YOUNGEST input (so with the HIGHEST block || tx || output number)
            }
            publishedUTXOs[scratchSpace[0]] = utxo;
            publishedTransaction.inputIndexes.push(scratchSpace[0]);
            emit InputIsPublished(scratchSpace[0]);
        } 
        // now we have determined the priority over all the inputs and can check for collisions
        // now we are sure that input matches an output or at least optimistic
        if (clashOnTheInput) { // loop again and check for priorities
            for (scratchSpace[2] = 0; scratchSpace[2] < TX.inputs.length; scratchSpace[2]++) { // for every input check that it was never published in another transaction
                txInput = TX.inputs[scratchSpace[2]];
                scratchSpace[0] = PlasmaTransactionLibrary.makeInputOrOutputIndex(txInput.blockNumber, txInput.txNumberInBlock, txInput.outputNumberInTX);
                utxo = publishedUTXOs[scratchSpace[0]];
                if (utxo.spendingTransactionIndex == 0) {
                    continue;
                }
                Transaction storage previouslyPublishedTransaction = publishedTransactions[utxo.spendingTransactionIndex];
                // detatch an input that was shown before
                if (previouslyPublishedTransaction.priority > scratchSpace[1]) {
                    previouslyPublishedTransaction.isCanonical = false;
                    detachedInputs[uint256(scratchSpace[3])] = scratchSpace[0];
                    scratchSpace[3]++;
                    utxo.collateralHolder = msg.sender;
                    if (utxo.amountAndOwnerConfirmed) {
                        if (utxo.originalOwner != TX.sender || utxo.value != txInput.amount) {
                            transactionIsNonCanonical = true;
                        } else {
                            utxo.spendingTransactionIndex = publishedTransactionIndex;
                            utxo.isLinkedToLimbo = publishedTransaction.isLimbo;
                        }
                    }
                    else {
                        revert("Outputs used in limbo TX should have beed published and confirmed");
                    }
                    // else if (utxo.originalOwner != TX.sender || utxo.value != txInput.amount) {
                    //     utxo.originalOwner = TX.sender;
                    //     utxo.value = txInput.amount;
                    //     utxo.spendingTransactionIndex = publishedTransactionIndex;
                    //     utxo.isLinkedToLimbo = publishedTransaction.isLimbo;
                    // }
                } else { // priority is lower, so transaction is non-canonical
                    revert("There was previously published with higher priority than this limbo exit");
                    transactionIsNonCanonical = true;
                    // require(_isNonCanonical);
                }
            }
        }
        publishedTransaction.isCanonical = !transactionIsNonCanonical;
        publishedTransaction.priority = scratchSpace[1];
        publishedTransaction.status = PublishedTXstatusWaitingForInputChallenges;
        // detachedInputs.length = uint256(scratchSpace[3]);
        return (publishedTransaction, detachedInputs);

    }

    function createLimboOutputs(
        Transaction storage publishedTransaction, 
        PlasmaTransactionLibrary.PlasmaTransaction memory TX,
        uint160 transactionHash)
    internal returns(Transaction storage _publishedTransaction) {
        if (publishedTransaction.status == PublishedTXstatusWaitingForInputChallenges) {
            // we should mark what outputs are not yet spent by other inputs already shown to the contract
            uint176[] memory scratchSpace = new uint176[](2);
            UTXO memory utxo;
            PlasmaTransactionLibrary.TransactionOutput memory txOutput;
            // for every input check that it was never consumed by other input
            // simultaneously check if an UTXO was already posted, that owner and amount match
            for (scratchSpace[1] = 0; scratchSpace[1] < TX.outputs.length; scratchSpace[1]++) { 
                txOutput = TX.outputs[scratchSpace[1]];
                require(txOutput.outputNumberInTX == scratchSpace[1]); // check that numbering is correct. Not too important, but keep for now
                scratchSpace[0] = uint176(transactionHash) << 16;
                scratchSpace[0] += uint176(txOutput.outputNumberInTX);
                utxo = limboUTXOs[scratchSpace[0]];
                utxo.originalOwner = txOutput.recipient;
                utxo.value = txOutput.amount;
                utxo.utxoStatus = UTXOstatusUnspent;
                utxo.isLinkedToLimbo = true;
                publishedTransaction.limboOutputIndexes.push(txOutput.outputNumberInTX);
                utxo.amountAndOwnerConfirmed = true;
                limboUTXOs[scratchSpace[0]] = utxo;
                emit LimboOutputIsPublished(scratchSpace[0]);
            } 
            return publishedTransaction;
        } else {
            revert();
            // should never happen
        }
    }

}

