pragma solidity ^0.4.24;

import {PlasmaTransactionLibrary} from "./PlasmaTransactionLibrary.sol";
import {PlasmaBlockStorageInterface} from "./PlasmaBlockStorage.sol";
import {PriorityQueueInterface} from "./PriorityQueue.sol";
import {StructuresLibrary} from "./UTXO.sol";
import {SafeMath} from "./SafeMath.sol";

contract PlasmaParent {
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

    mapping(address => bytes32[]) public allExitsForUser;
    mapping(bytes32 => ExitBuyoutOffer) public exitBuyoutOffers;

    uint8 constant UTXOstatusNull = 0;
    uint8 constant UTXOstatusUnspent = 1;
    uint8 constant UTXOstatusSpent = 2;

    uint8 constant ExitStatusNull = 0;
    uint8 constant ExitStatusWaitingForInputChallenges = 1;
    uint8 constant ExitStatusWaitingForOutputChallenges = 2;

    // mapping(bytes32 => TX.Transaction) public publishedTransactions;
    // mapping(bytes32 => TX.UTXO) public publishedUTXOs;
    mapping(bytes32 => StructuresLibrary.ExitRecord) public exitRecords;

    // mapping(bytes32 => TX.Transaction) public limboTransactions;
    // mapping(bytes32 => TX.UTXO) public limboUTXOs;

    event TransactionPublished(bytes32 indexed _hash, bytes _data);
    event ExitRecordCreated(bytes32 indexed _hash);
    event ExitChallenged(bytes32 indexed _hash);
    event InputIsPublished(uint72 indexed _index);
    event OutputIsPublished(uint72 indexed _index);
    event TransactionIsPublished(uint64 indexed _index);
// end of storage declarations --------------------------- 

    constructor(address _priorityQueue, address _blockStorage) public payable {
        require(_priorityQueue != address(0));
        require(_blockStorage != address(0));
        exitQueue = PriorityQueueInterface(_priorityQueue);
        blockStorage = PlasmaBlockStorageInterface(_blockStorage);
        operatorsBond = msg.value;
    }

    function setOperator(address _op, uint256 _status) public returns (bool success) {
        require(msg.sender == owner);
        return blockStorage.setOperator(_op, _status);
    }

    function setDelegates(address _exitProcessor, address _challenger, address _limboExit) public returns (bool success) {
        require(msg.sender == owner);
        require(_exitProcessor != address(0));
        require(_challenger != address(0));
        require(_limboExit != address(0));
        require(exitProcessorContract == address(0));
        require(challengesContract == address(0));
        require(limboExitContract == address(0));
        exitProcessorContract = _exitProcessor;
        limboExitContract = _limboExit;
        challengesContract = _challenger;
        return true;
    }

    function setErrorAndLastFoundBlock(uint32 _invalidBlockNumber, bool _transferReward, address _payTo) internal returns (bool success) {
        if (!plasmaErrorFound) {
            plasmaErrorFound = true;
        }
        if (lastValidBlock == 0) {
            lastValidBlock = _invalidBlockNumber-1;
        } else {
            if(lastValidBlock >= _invalidBlockNumber) {
                lastValidBlock = _invalidBlockNumber-1;
            }
        }
        blockStorage.incrementWeekOldCounter();
        emit ErrorFoundEvent(lastValidBlock);
        if (operatorsBond != 0) {
            uint256 bond = operatorsBond;
            operatorsBond = 0;
            if (_transferReward) {
                address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF).transfer(bond / 2);
                _payTo.transfer(bond / 2);
            }
        }
        return true;
    }

    function submitBlockHeaders(bytes _headers) public returns (bool success) {
        require(!plasmaErrorFound);
        return blockStorage.submitBlockHeaders(_headers);
    }

    function lastBlockNumber() public view returns (uint256 blockNumber) {
        return blockStorage.lastBlockNumber();
    }

    function hashOfLastSubmittedBlock() public view returns(bytes32) {
        return blockStorage.hashOfLastSubmittedBlock();
    }

    modifier adjustsTime() {
        blockStorage.incrementWeekOldCounter();
        _;
    }
// ----------------------------------

// ----------------------------------
// Deposit related functions

    function deposit() payable public returns (bool success) {
        return depositFor(msg.sender);
    }

    function depositFor(address _for) payable public returns (bool success) {
        require(msg.value > 0);
        require(!plasmaErrorFound);
        uint256 size;
        assembly {
            size := extcodesize(_for)
        }
        if (size > 0) {
            revert();
        }
        uint256 depositIndex = depositCounter;
        DepositRecord storage record = depositRecords[depositIndex];
        require(record.status == DepositStatusNoRecord);
        record.from = _for;
        record.amount = msg.value;
        record.status = DepositStatusDeposited;
        depositCounter = depositCounter + 1;
        emit DepositEvent(_for, msg.value, depositIndex);
        allDepositRecordsForUser[_for].push(depositIndex);
        return true;
    }

// ----------------------------------

    function startExit (
        uint32 _plasmaBlockNumber, // block with the transaction
        uint8 _outputNumber,    // output being exited
        bytes _plasmaTransaction, // transaction itself
        bytes _merkleProof) // proof
    public payable adjustsTime returns(bool success) {
        // first parse the transaction and check basic validity rules
        PlasmaTransactionLibrary.PlasmaTransaction memory TX = checkForValidityAndInclusion(_plasmaBlockNumber, _plasmaTransaction, _merkleProof);
        //determine a priority based on a youngest input OR time delay from now
        uint72[] memory scratchSpace = new uint72[](3); 
        // uint72 priority = scratchSpace[0];
        if (TX.txType == TxTypeFund) {
            require(blockStorage.isOperator(TX.sender));
            require(TX.inputs.length == 1);
            DepositRecord storage depositRecord = depositRecords[TX.inputs[0].amount];
            if (depositRecord.status == DepositStatusDeposited) {
                require(TX.outputs[0].recipient == depositRecord.from);
                require(TX.outputs[0].amount == depositRecord.amount);
                depositRecord.status = DepositStatusDepositConfirmed;
            } else {
                require(depositRecord.status == DepositStatusDepositConfirmed);
            }
            scratchSpace[0] = uint72(blockStorage.weekOldBlockNumber() << (32 + 8));
        } else {
            PlasmaTransactionLibrary.TransactionInput memory txInput;
            for (scratchSpace[1] = 0; scratchSpace[1] < TX.inputs.length; scratchSpace[1]++) {
                txInput = TX.inputs[scratchSpace[1]];
                scratchSpace[2] = PlasmaTransactionLibrary.makeInputOrOutputIndex(txInput.blockNumber, txInput.txNumberInBlock, txInput.outputNumberInTX);
                if (scratchSpace[0] < scratchSpace[2]) {
                    scratchSpace[0] = scratchSpace[2];
                }
            }
            if (scratchSpace[0] < blockStorage.weekOldBlockNumber() << (32 + 8)) {
                scratchSpace[0] = uint72(blockStorage.weekOldBlockNumber() << (32 + 8));
            }
        }
        // // to save the gas costs we only store the transaction hash that is binding to the content and position
        // bytes32 transactionHash = keccak256(abi.encodePacked(_plasmaBlockNumber, TX.txNumberInBlock, _plasmaTransaction));
        // to save the gas costs we only store the transaction hash that is binding to the content
        bytes32 transactionHash = keccak256(abi.encodePacked(_plasmaTransaction));
        PlasmaTransactionLibrary.TransactionOutput memory txOutput = TX.outputs[_outputNumber];
        require(txOutput.recipient == msg.sender);
        require(txOutput.outputNumberInTX == _outputNumber);
        StructuresLibrary.ExitRecord memory exitRecord;
        exitRecord.transactionRef = transactionHash;
        exitRecord.timePublished = uint64(block.timestamp);
        exitRecord.amount = txOutput.amount;
        exitRecord.owner = txOutput.recipient;
        exitRecord.blockNumber = _plasmaBlockNumber;
        exitRecord.transactionNumber = TX.txNumberInBlock;
        exitRecord.outputNumber = _outputNumber;
        exitRecord.isValid = true;
        bytes32 exitRecordHash = StructuresLibrary.getCompactExitRecordCommitment(exitRecord);
        require(exitRecords[exitRecordHash].transactionRef == bytes32(0));
        exitRecords[exitRecordHash] = exitRecord;
        emit TransactionPublished(transactionHash, _plasmaTransaction);
        scratchSpace[2] = PlasmaTransactionLibrary.makeInputOrOutputIndex(_plasmaBlockNumber, TX.txNumberInBlock, _outputNumber);
        emit ExitStartedEvent(msg.sender, scratchSpace[0], scratchSpace[2]);
        emit ExitRecordCreated(exitRecordHash);
        require(msg.value == WithdrawCollateral);
        allExitsForUser[msg.sender].push(exitRecordHash);
        // TODO should put it into the queue here 
        return true;
    }

    function challengeNormalExitByShowingExitBeingSpent(
        bytes32 _exitRecordHash,
        uint32 _plasmaBlockNumber, //references and proves ownership on withdraw transaction
        bytes _plasmaTransaction,
        bytes _merkleProof,
        uint8 _inputNumber) 
    public returns(bool success) {
        StructuresLibrary.ExitRecord storage exitRecord = exitRecords[_exitRecordHash];
        require(exitRecord.isValid);
        PlasmaTransactionLibrary.PlasmaTransaction memory TX = checkForValidityAndInclusion(_plasmaBlockNumber, _plasmaTransaction, _merkleProof);
        PlasmaTransactionLibrary.TransactionInput memory txInput = TX.inputs[_inputNumber];
        require(txInput.blockNumber == exitRecord.blockNumber);
        require(txInput.txNumberInBlock == exitRecord.transactionNumber);
        require(txInput.outputNumberInTX == exitRecord.outputNumber);
        require(TX.sender == exitRecord.owner);
        require(txInput.amount == exitRecord.amount);
        exitRecord.isValid = false;
        emit ExitChallenged(_exitRecordHash);
        msg.sender.transfer(WithdrawCollateral);
        return true;
    }

    function challengeNormalExitByShowingAnInputDoubleSpend(
        bytes _originalTransaction,
        uint8 _originalInputNumber,
        bytes32 _exitRecordHash,
        uint32 _plasmaBlockNumber, 
        bytes _plasmaTransaction,
        bytes _merkleProof,
        uint8 _inputNumber)
    public returns (bool success) {
        StructuresLibrary.ExitRecord storage exitRecord = exitRecords[_exitRecordHash];
        require(exitRecord.isValid);
        PlasmaTransactionLibrary.PlasmaTransaction memory TX = checkForValidityAndInclusion(_plasmaBlockNumber, _plasmaTransaction, _merkleProof);
        require(exitRecord.transactionRef == keccak256(_originalTransaction));
        PlasmaTransactionLibrary.PlasmaTransaction memory originalTX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_originalTransaction);
        PlasmaTransactionLibrary.TransactionInput memory txInput = TX.inputs[_inputNumber];
        PlasmaTransactionLibrary.TransactionInput memory originalTxInput = originalTX.inputs[_originalInputNumber];
        require(txInput.blockNumber == originalTxInput.blockNumber);
        require(txInput.txNumberInBlock == originalTxInput.txNumberInBlock);
        require(txInput.outputNumberInTX == originalTxInput.outputNumberInTX);
        require(TX.sender == originalTX.sender);
        require(txInput.amount == originalTxInput.amount);
        exitRecord.isValid = false;
        emit ExitChallenged(_exitRecordHash);
        msg.sender.transfer(WithdrawCollateral);
        return true;
    }

    function challengeNormalExitByShowingMismatchedInput(
        bytes _originalTransaction,
        uint8 _originalInputNumber,
        bytes32 _exitRecordHash,
        uint32 _plasmaBlockNumber, 
        bytes _plasmaTransaction,
        bytes _merkleProof,
        uint8 _outputNumber)
    public returns (bool success) {
        StructuresLibrary.ExitRecord storage exitRecord = exitRecords[_exitRecordHash];
        require(exitRecord.isValid);
        PlasmaTransactionLibrary.PlasmaTransaction memory TX = checkForValidityAndInclusion(_plasmaBlockNumber, _plasmaTransaction, _merkleProof);
        require(exitRecord.transactionRef == keccak256(_originalTransaction));
        PlasmaTransactionLibrary.PlasmaTransaction memory originalTX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_originalTransaction);
        PlasmaTransactionLibrary.TransactionOutput memory txOutput = TX.outputs[_outputNumber];
        PlasmaTransactionLibrary.TransactionInput memory originalTxInput = originalTX.inputs[_originalInputNumber];
        // first we require(!) enumeration parameters
        require(_outputNumber == txOutput.outputNumberInTX);
        require(_plasmaBlockNumber == originalTxInput.blockNumber);
        require(TX.txNumberInBlock == originalTxInput.txNumberInBlock);
        require(_outputNumber == originalTxInput.outputNumberInTX);
        // then we require some mismatch
        require(txOutput.recipient != originalTX.sender || txOutput.amount != originalTxInput.amount);
        exitRecord.isValid = false;
        emit ExitChallenged(_exitRecordHash);
        msg.sender.transfer(WithdrawCollateral);
        return true;
    }

//     function finalizeExits(uint256 _numOfExits) public returns (bool success) {
//         uint256 toSend = 0;
//         address beneficiary = address(0);
//         bool result = false;
//         for (uint i = 0; i < _numOfExits; i++) {
//             (uint8 recordType, bytes22 index) = exitQueue.delMin();
//             if (recordType == 1) {
//                 result = attemptNormalExit(uint72(index));
                
//             } else if (recordType == 2) {
//                 result = attemptLimboExit(index);
//             } 
//             if (!result) {
//                 if (i == 0) {
//                     revert(); // save some gas
//                 } else {
//                     break; // priority did not mature
//                 }
//             }
//             if (exitQueue.currentSize() > 0) {
//                 toSend = 0;
//                 beneficiary = address(0);
//                 result = false;
//             } else {
//                 break;
//             }
//         }
//         return true;
//     }

//     function attemptNormalExit(uint72 _index) internal returns (bool success){
//         uint64 transactionIndex = uint64(_index >> 8);
//         Transaction storage originatingTransaction = publishedTransactions[transactionIndex];
//         if (!originatingTransaction.isCanonical) {
//             return true;
//         }
//         UTXO storage utxo = publishedUTXOs[originatingTransaction.outputIndexes[uint256(_index % 256)]];
//         if (utxo.succesfullyWithdrawn) {
//             return true;
//         }
//         if (utxo.dateExitAllowed > block.timestamp) {
//             return false;
//         }

//         if (utxo.utxoStatus == UTXOstatusUnspent && utxo.value != 0 && utxo.pendingExit) {
//             address beneficiary;
//             if (utxo.boughtBy != address(0)) {
//                 beneficiary = utxo.boughtBy;
//             } else {
//                 beneficiary = utxo.originalOwner;
//             }
//             uint256 toSend = utxo.value + WithdrawCollateral;
//             utxo.succesfullyWithdrawn = true;
//             if (beneficiary != address(0)) {
//                 beneficiary.transfer(toSend);
//             }
//         }
//         return true;
//     }

//     function attemptLimboExit(bytes22 _index) internal returns (bool success) {
//         uint160 transactionHash = uint160(uint176(_index) >> 16);
//         Transaction storage originatingTransaction = limboTransactions[transactionHash];
//         if (!originatingTransaction.isCanonical) {
//             return true;
//         }
//         UTXO storage utxo = limboUTXOs[uint176(_index)];
//         if (utxo.dateExitAllowed > block.timestamp) {
//             return false;
//         }
//         if (utxo.succesfullyWithdrawn) {
//             return true;
//         }
//         if (utxo.utxoStatus == UTXOstatusUnspent && utxo.value != 0 && utxo.pendingExit) {
//             address beneficiary;
//             if (utxo.boughtBy != address(0)) {
//                 beneficiary = utxo.boughtBy;
//             } else {
//                 beneficiary = utxo.originalOwner;
//             }
//             uint256 toSend = utxo.value + WithdrawCollateral;
//             utxo.succesfullyWithdrawn = true;
//             if (beneficiary != address(0)) {
//                 beneficiary.transfer(toSend);
//             }
//         }
//         return true;
//     }

//     function collectInputsCollateral(uint64 _transactionIndex) public returns (bool success) {
//         Transaction storage publishedTransaction = publishedTransactions[_transactionIndex];
//         require(publishedTransaction.isCanonical);
//         require(block.timestamp >= publishedTransaction.datePublished + InputChallangesDelay);
//         uint256 totalToSend = 0;
//         for (uint256 j = 0; j < publishedTransaction.inputIndexes.length; j++) {
//             UTXO storage utxo = publishedUTXOs[publishedTransaction.inputIndexes[j]];
//             if (utxo.collateralHolder == msg.sender) {
//                 totalToSend += WithdrawCollateral;
//                 delete utxo.collateralHolder;
//             }
//         }
//         require(totalToSend > 0);
//         msg.sender.transfer(totalToSend);
//         return true;
//     }

//     function offerOutputBuyout(uint72 _utxoIndex, address _beneficiary) public payable returns (bool success) {
//         require(msg.value > 0);
//         require(_beneficiary != address(0));
//         UTXO storage utxo = publishedUTXOs[_utxoIndex];
//         require(utxo.utxoStatus == UTXOstatusUnspent);
//         require(utxo.pendingExit);
//         require(!utxo.succesfullyWithdrawn);
//         ExitBuyoutOffer storage offer = exitBuyoutOffers[_utxoIndex];
//         emit WithdrawBuyoutOffered(_utxoIndex, _beneficiary, msg.value);
//         require(!offer.accepted);
//         address oldFrom = offer.from;
//         uint256 oldAmount = offer.amount;
//         require(msg.value > oldAmount);
//         offer.from = _beneficiary;
//         offer.amount = msg.value;
//         if (oldFrom != address(0)) {
//             oldFrom.transfer(oldAmount);
//         }
//         return true;
//     }

//     function acceptBuyoutOffer(uint72 _utxoIndex) public returns (bool success) {
//         UTXO storage utxo = publishedUTXOs[_utxoIndex];
//         require(utxo.utxoStatus == UTXOstatusUnspent);
//         require(utxo.pendingExit);
//         require(!utxo.succesfullyWithdrawn);
//         require(utxo.originalOwner == msg.sender);
//         ExitBuyoutOffer storage offer = exitBuyoutOffers[_utxoIndex];
//         require(offer.from != address(0));
//         require(!offer.accepted);
//         address oldBeneficiary = utxo.originalOwner;
//         uint256 offerAmount = offer.amount;
//         utxo.boughtBy = offer.from;
//         offer.accepted = true;
//         emit WithdrawBuyoutAccepted(_utxoIndex, utxo.boughtBy); 
//         oldBeneficiary.transfer(offerAmount);
//         return true;
//     }

//     function returnExpiredBuyoutOffer(uint72 _utxoIndex) public returns (bool success) {
//         // WithdrawRecord storage record = withdrawRecords[_withdrawIndex];
//         ExitBuyoutOffer storage offer = exitBuyoutOffers[_utxoIndex];
//         require(!offer.accepted);
//         // require(record.status != WithdrawStatusStarted || (block.timestamp >= record.timestamp + WithdrawDelay));
//         address oldFrom = offer.from;
//         uint256 oldAmount = offer.amount;
//         require(msg.sender == oldFrom);
//         delete exitBuyoutOffers[_utxoIndex];
//         if (oldFrom != address(0)) {
//             oldFrom.transfer(oldAmount);
//         }
//         return true;
//     }

// // assume that there is a yet CANONICAL transaction published and UTXO is potentially pending for exit
// // we either mark a spending transaction with 
//     function markInputAsDoubleSpent(
//         uint32 _plasmaBlockNumber, // block with the transaction
//         bytes _plasmaTransaction, // transaction itself
//         bytes _merkleProof,
//         uint8 _inputNumber
//         ) // proof) public returns (bool success) {
//     public returns(bool success) {
//         PlasmaTransactionLibrary.PlasmaTransaction memory TX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_plasmaTransaction);
//         require(TX.isWellFormed);
//         require(TX.txType == TxTypeSplit || TX.txType == TxTypeMerge);
//         (bool included, uint256 txNumber) = PlasmaTransactionLibrary.checkForInclusionIntoBlock(blockStorage.getMerkleRoot(_plasmaBlockNumber), _plasmaTransaction, _merkleProof);
//         require(included);
//         TX.txNumberInBlock = uint32(txNumber);
//         uint72[] memory scratchSpace = new uint72[](2);
//         PlasmaTransactionLibrary.TransactionInput memory txInput;
//         for (scratchSpace[2] = 0; scratchSpace[2] < TX.inputs.length; scratchSpace[2]++) { 
//             txInput = TX.inputs[scratchSpace[2]];
//             scratchSpace[0] = PlasmaTransactionLibrary.makeInputOrOutputIndex(txInput.blockNumber, txInput.txNumberInBlock, txInput.outputNumberInTX); // utxo index being refered
//             if (scratchSpace[1] == 0) { // set priority anyway
//                 scratchSpace[1] = scratchSpace[0];
//             } else if (scratchSpace[1] < scratchSpace[0]) { // transaction's inverse priority (so lower the better) 
//                 scratchSpace[1] = scratchSpace[0]; // is the index of the YOUNGEST input (so with the HIGHEST block || tx || output number)
//             }
//         }
//         txInput = TX.inputs[_inputNumber];
//         scratchSpace[0] = PlasmaTransactionLibrary.makeInputOrOutputIndex(txInput.blockNumber, txInput.txNumberInBlock, txInput.outputNumberInTX);
//         UTXO storage utxo = publishedUTXOs[scratchSpace[0]];
//         require(utxo.utxoStatus != UTXOstatusNull);
//         if (utxo.amountAndOwnerConfirmed) { // this utxo was already once published
//             if (utxo.originalOwner != TX.sender || utxo.value != txInput.amount) {
//                 // so, an operator has allowed illegitimate spend, as now we are processing a transaction,
//                 // that is included in block. Give the reward
//                 setErrorAndLastFoundBlock(_plasmaBlockNumber - 1, true, msg.sender);
//                 return true;
//             }
//         }
        
//         if (utxo.utxoStatus == UTXOstatusUnspent) {
//             if (utxo.succesfullyWithdrawn) {
//                 setErrorAndLastFoundBlock(_plasmaBlockNumber - 1, true, msg.sender);
//                 return true;
//             } else {
//                 // require(block.timestamp < previouslyPublishedTransaction.datePublished + ExitDelay);
//                 // don't check a time delay, always challenge untill it's exited
//                 utxo.pendingExit = false;
//                 utxo.isLinkedToLimbo = false;
//                 utxo.utxoStatus = UTXOstatusSpent;
//                 require(utxo.collateralHolder != address(0));
//                 delete utxo.collateralHolder;
//                 msg.sender.transfer(WithdrawCollateral);
//                 return true;
//             }
//         } else {
//             require(block.timestamp < previouslyPublishedTransaction.datePublished + InputChallangesDelay);
//             Transaction storage previouslyPublishedTransaction = publishedTransactions[utxo.spendingTransactionIndex];
//             if (utxo.isLinkedToLimbo) {
//                 previouslyPublishedTransaction = limboTransactions[utxo.spendingTransactionIndex];
//             }
//             require(previouslyPublishedTransaction.isCanonical);
//             require(previouslyPublishedTransaction.priority > scratchSpace[1]);
//             require(utxo.collateralHolder != address(0));
//             previouslyPublishedTransaction.isCanonical = false;
//             utxo.isLinkedToLimbo = false;
//             delete utxo.collateralHolder;
//             msg.sender.transfer(WithdrawCollateral);
//             return true;
//         } 
//         revert();
//         return false;
//     }

// ----------------------------------
    function checkForValidityAndInclusion(
        uint32 _plasmaBlockNumber, // block with the transaction
        bytes _plasmaTransaction, // transaction itself
        bytes _merkleProof)
    internal returns(PlasmaTransactionLibrary.PlasmaTransaction memory TX) {
        TX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_plasmaTransaction);
        require(isWellFormedDecodedTransaction(TX));
        (bool included, uint256 txNumber) = PlasmaTransactionLibrary.checkForInclusionIntoBlock(blockStorage.getMerkleRoot(_plasmaBlockNumber), _plasmaTransaction, _merkleProof);
        require(included);
        TX.txNumberInBlock = uint32(txNumber);
        return TX;
    }

    function isWellFormedTransaction(bytes _plasmaTransaction) public view returns (bool isWellFormed) {
        PlasmaTransactionLibrary.PlasmaTransaction memory TX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_plasmaTransaction);
        return isWellFormedDecodedTransaction(TX);
    }

    function isWellFormedDecodedTransaction(PlasmaTransactionLibrary.PlasmaTransaction memory TX) internal view returns (bool isWellFormed) {
        if (TX.sender == address(0) || !TX.isWellFormed) {
            return false;
        }
        uint256 balance = 0;
        uint256 counter = 0;
        if (TX.txType == TxTypeFund) {
            if (TX.inputs.length != 1) {
                return false;
            }
            PlasmaTransactionLibrary.TransactionInput memory input = TX.inputs[0];
            return blockStorage.isOperator(TX.sender) && input.blockNumber == 0 && input.txNumberInBlock == 0 && input.outputNumberInTX == 0;
        } else if (TX.txType == TxTypeSplit || TX.txType == TxTypeMerge) {
            for (counter = 0; counter < TX.inputs.length; counter++) {
                balance = SafeMath.add(balance, TX.inputs[counter].amount);
            }
            for (counter = 0; counter < TX.outputs.length; counter++) {
                balance = SafeMath.sub(balance, TX.inputs[counter].amount);
            }
            if (balance != 0) {
                return false;
            }
            return true;
        }
        return false;
    }

// ----------------------------------

    function() external payable{
        address callee = exitProcessorContract;
        assembly {
            let memoryPointer := mload(0x40)
            calldatacopy(memoryPointer, 0, calldatasize)
            let newFreeMemoryPointer := add(memoryPointer, calldatasize)
            mstore(0x40, newFreeMemoryPointer)
            let retVal := delegatecall(sub(gas, 10000), callee, memoryPointer, calldatasize, newFreeMemoryPointer, 0x40)
            let retDataSize := returndatasize
            returndatacopy(newFreeMemoryPointer, 0, retDataSize)
            switch retVal case 0 { revert(0,0) } default { return(newFreeMemoryPointer, retDataSize) }
        }
    }

}
