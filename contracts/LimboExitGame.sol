pragma solidity ^0.4.24;

import {PlasmaTransactionLibrary} from "./PlasmaTransactionLibrary.sol";
import {PlasmaBlockStorageInterface} from "./PlasmaBlockStorage.sol";
import {PriorityQueueInterface} from "./PriorityQueue.sol";
import {StructuresLibrary} from "./Structures.sol";
import {SafeMath} from "./SafeMath.sol";

contract PlasmaLimboExitGame {
// begining of storage declaration

    bool public plasmaErrorFound;
    uint32 public lastValidBlock;
    uint256 public operatorsBond;

    PriorityQueueInterface public exitQueue;
    PlasmaBlockStorageInterface public blockStorage;
    address public challengesContract;
    address public limboExitContract;
    address public buyoutProcessorContract;
    address public owner = msg.sender;

    uint256 public depositCounter;

    uint256 public constant DepositWithdrawCollateral = 50000000000000000;
    uint256 public constant WithdrawCollateral = 50000000000000000;
    uint256 public constant DepositWithdrawDelay = (72 hours);
    uint256 public constant LimboChallangesDelay = (72 hours);
    uint256 public constant ExitDelay = (168 hours);

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

    mapping(uint256 => DepositRecord) public depositRecords;
    mapping(address => uint256[]) public allDepositRecordsForUser;

    struct ExitBuyoutOffer {
        uint256 amount;
        address from;
        bool accepted;
    }

    mapping(address => bytes22[]) public allExitsForUser;
    mapping(bytes22 => ExitBuyoutOffer) public exitBuyoutOffers;

    mapping(bytes22 => StructuresLibrary.ExitRecord) public exitRecords;
    mapping(bytes22 => StructuresLibrary.LimboData) limboExitsData;
    mapping(bytes22 => bool) public succesfulExits;

    event ErrorFoundEvent(uint256 indexed _lastValidBlockNumber);

    event DepositEvent(address indexed _from, uint256 indexed _amount, uint256 indexed _depositIndex);
    event DepositWithdrawStartedEvent(uint256 indexed _depositIndex);
    event DepositWithdrawChallengedEvent(uint256 indexed _depositIndex);
    event DepositWithdrawCompletedEvent(uint256 indexed _depositIndex);

    event TransactionPublished(bytes32 indexed _hash, bytes _data);
    event ExitRecordCreated(bytes22 indexed _partialHash);
    event ExitChallenged(bytes22 indexed _partialHash);
    event TransactionIsPublished(uint64 indexed _index);
    event ExitStartedEvent(address indexed _from, uint72 _priority, uint72 indexed _index, bytes22 indexed _partialHash);

    event LimboExitStartedEvent(address indexed _from, uint72 indexed _priority, bytes22 indexed _partialHash);
    event LimboExitChallengePublished(bytes22 indexed _partialHash, address indexed _from, uint8 _challengeNumber, uint8 _inputNumber);
    event ExitBuyoutOffered(bytes22 indexed _partialHash, address indexed _from, uint256 indexed _buyoutAmount);
    event ExitBuyoutAccepted(bytes22 indexed _partialHash, address indexed _from);    
// end of storage declarations --------------------------- 

    modifier adjustsTime() {
        blockStorage.incrementWeekOldCounter();
        _;
    }

    constructor() public {
    }
// ----------------------------------

// Withdraw related functions

    // Starts a Limbo exit (without inclusion proof) for some transaction
    function startLimboExit(
        uint8 _outputNumber,    // output being exited
        bytes _plasmaTransaction) // transaction itself
    public payable adjustsTime returns(bool success) {
        // by default an exitor puts a bond on one output only
        require(msg.value == WithdrawCollateral);
        PlasmaTransactionLibrary.PlasmaTransaction memory TX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_plasmaTransaction);
        require(isWellFormedDecodedTransaction(TX));
        //determine a priority based on a youngest input OR time delay from now
        require(TX.txType == TxTypeMerge || TX.txType == TxTypeSplit);
        uint72[] memory scratchSpace = new uint72[](3); 
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
        // // to save the gas costs we only store the transaction hash that is binding to the content and position
        // bytes32 transactionHash = keccak256(abi.encodePacked(_plasmaBlockNumber, TX.txNumberInBlock, _plasmaTransaction));
        // to save the gas costs we only store the transaction hash that is binding to the content
        bytes32 transactionHash = keccak256(_plasmaTransaction);
        StructuresLibrary.ExitRecord memory exitRecord;
        exitRecord.transactionRef = transactionHash;
        exitRecord.timePublished = uint64(block.timestamp);
        exitRecord.isValid = true;
        exitRecord.isLimbo = true;
        bytes22 exitRecordHash = StructuresLibrary.getCompactExitRecordCommitment(exitRecord);
        require(exitRecords[exitRecordHash].transactionRef == bytes32(0));
        exitRecords[exitRecordHash] = exitRecord;
        // write only the minimal information about the exit itself, now write to Limbo information
        StructuresLibrary.LimboData storage limboInfo = limboExitsData[exitRecordHash];
        for (uint8 i = 0; i < TX.outputs.length; i++) {
            PlasmaTransactionLibrary.TransactionOutput memory txOutput = TX.outputs[i];
            if (i == _outputNumber) {
                StructuresLibrary.addOutput(limboInfo, txOutput.recipient, txOutput.amount, true);
            } else {
                StructuresLibrary.addOutput(limboInfo, txOutput.recipient, txOutput.amount, false);
            }
        }
        exitQueue.insert(scratchSpace[0], exitRecordHash);
        emit TransactionPublished(transactionHash, _plasmaTransaction);
        emit LimboExitStartedEvent(msg.sender, scratchSpace[0], exitRecordHash);
        emit ExitRecordCreated(exitRecordHash);
        return true;
    }

    function joinLimboExit(
        bytes22 _index,
        uint8 _outputNumber
    ) payable public returns (bool success) {
        require(msg.value == WithdrawCollateral);
        StructuresLibrary.ExitRecord storage exitRecord = exitRecords[_index];
        require(exitRecord.isValid == true);
        require(block.timestamp > exitRecord.timePublished + LimboChallangesDelay);
        StructuresLibrary.LimboData storage limboInfo = limboExitsData[_index];
        require(!limboInfo.outputs[_outputNumber].isPegged);
        limboInfo.outputs[_outputNumber].isPegged = true;
        return true;
    }

    function putChallengeOnLimboExitInput(
        bytes22 _index,
        uint8 _inputNumber
    ) public payable returns (bool success) {
        require(msg.value == WithdrawCollateral);
        StructuresLibrary.ExitRecord storage exitRecord = exitRecords[_index];
        require(exitRecord.isValid == true);
        require(block.timestamp <= exitRecord.timePublished + LimboChallangesDelay);
        StructuresLibrary.LimboData storage limboInfo = limboExitsData[_index];
        for (uint8 i = 0; i < limboInfo.inputChallenges.length; i++) {
            require(_inputNumber != limboInfo.inputChallenges[i].inputNumber);
        }
        StructuresLibrary.LimboInputChallenge memory limboInputChallenge;
        limboInputChallenge.from = msg.sender;
        limboInputChallenge.inputNumber = _inputNumber;
        limboInfo.inputChallenges.push(limboInputChallenge);
        emit LimboExitChallengePublished(_index, msg.sender, uint8(limboInfo.inputChallenges.length-1), _inputNumber);
        return true;
    }

    function resolveChallengeOnInput(
        bytes22 _index,
        uint8 _challengeNumber,
        bytes _exitingTransaction,
        uint32 _originatingPlasmaBlockNumber,
        bytes _originatingPlasmaTransaction,
        bytes _merkleProof
    ) public returns(bool success) {
        StructuresLibrary.ExitRecord storage exitRecord = exitRecords[_index];
        bytes32 transactionHash = keccak256(_exitingTransaction);
        require(exitRecord.transactionRef == transactionHash);
        require(exitRecord.isValid == true);
        StructuresLibrary.LimboInputChallenge storage limboInputChallenge = limboExitsData[_index].inputChallenges[_challengeNumber];
        require(limboInputChallenge.from != address(0));
        require(!limboInputChallenge.resolved);
        PlasmaTransactionLibrary.PlasmaTransaction memory TX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_exitingTransaction);
        PlasmaTransactionLibrary.PlasmaTransaction memory originatingTX = checkForValidityAndInclusion(_originatingPlasmaBlockNumber, _originatingPlasmaTransaction, _merkleProof);
        PlasmaTransactionLibrary.TransactionInput memory txInput = TX.inputs[limboInputChallenge.inputNumber];
        require(_originatingPlasmaBlockNumber == txInput.blockNumber);
        require(originatingTX.txNumberInBlock == txInput.txNumberInBlock);
        PlasmaTransactionLibrary.TransactionOutput memory txOutput = originatingTX.outputs[txInput.outputNumberInTX];
        require(txOutput.recipient == TX.sender);
        require(txOutput.amount == txInput.amount);
        limboInputChallenge.resolved = true;
        msg.sender.transfer(WithdrawCollateral);
        return true;
    }

    function challengeLimboExitByShowingAnInputAlreadySpent(
        bytes22 _index,
        uint8 _exitingInputNumber,
        bytes _exitingTransaction,
        uint32 _plasmaBlockNumber,
        bytes _plasmaTransaction,
        bytes _merkleProof,
        uint8 _inputNumber
    ) public returns(bool success) {
        StructuresLibrary.ExitRecord storage exitRecord = exitRecords[_index];
        bytes32 transactionHash = keccak256(_exitingTransaction);
        require(exitRecord.transactionRef == transactionHash);
        require(exitRecord.isValid == true);
        require(block.timestamp <= exitRecord.timePublished + LimboChallangesDelay);
        PlasmaTransactionLibrary.PlasmaTransaction memory TX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_exitingTransaction);
        PlasmaTransactionLibrary.PlasmaTransaction memory includedTX = checkForValidityAndInclusion(_plasmaBlockNumber, _plasmaTransaction, _merkleProof);
        require(TX.sender == includedTX.sender);
        PlasmaTransactionLibrary.TransactionInput memory exitingInput = TX.inputs[_exitingInputNumber];
        PlasmaTransactionLibrary.TransactionInput memory includedInput = includedTX.inputs[_inputNumber];
        require(exitingInput.blockNumber == includedInput.blockNumber);
        require(exitingInput.txNumberInBlock == includedInput.txNumberInBlock);
        require(exitingInput.outputNumberInTX == includedInput.outputNumberInTX);
        require(exitingInput.amount == includedInput.amount);
        exitRecord.isValid = false;
        payForLimboInputChallenge(_index, msg.sender);
        return true;
    }

    function challengeLimboExitByShowingMismatchedInput(
        bytes22 _index,
        uint8 _inputNumber,
        bytes _exitingTransaction,
        uint32 _originatingPlasmaBlockNumber,
        bytes _originatingPlasmaTransaction,
        bytes _merkleProof
    ) public returns(bool success) {
        StructuresLibrary.ExitRecord storage exitRecord = exitRecords[_index];
        bytes32 transactionHash = keccak256(_exitingTransaction);
        require(exitRecord.transactionRef == transactionHash);
        require(exitRecord.isValid == true);
        require(block.timestamp <= exitRecord.timePublished + LimboChallangesDelay);
        PlasmaTransactionLibrary.PlasmaTransaction memory TX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_exitingTransaction);
        PlasmaTransactionLibrary.PlasmaTransaction memory originatingTX = checkForValidityAndInclusion(_originatingPlasmaBlockNumber, _originatingPlasmaTransaction, _merkleProof);
        PlasmaTransactionLibrary.TransactionInput memory txInput = TX.inputs[_inputNumber];
        require(_originatingPlasmaBlockNumber == txInput.blockNumber);
        require(originatingTX.txNumberInBlock == txInput.txNumberInBlock);
        PlasmaTransactionLibrary.TransactionOutput memory txOutput = originatingTX.outputs[txInput.outputNumberInTX];
        require(txOutput.recipient != TX.sender || txOutput.amount != txInput.amount);
        exitRecord.isValid = false;
        payForLimboInputChallenge(_index, msg.sender);
        return true;
    }

    function payForLimboInputChallenge(
        bytes22 _index,
        address _to
    ) internal {
        _to.transfer(uint256(limboExitsData[_index].outputs.length) * WithdrawCollateral);
    }

    function collectChallengeCollateral(
        bytes22 _index,
        uint8 _challengeNumber
    ) public returns (bool success) {
        StructuresLibrary.ExitRecord storage exitRecord = exitRecords[_index];
        require(exitRecord.transactionRef == bytes32(0));
        require(!succesfulExits[_index]);
        StructuresLibrary.LimboData storage limboExitInfo = limboExitsData[_index];
        StructuresLibrary.LimboInputChallenge storage limboInputChallenge = limboExitInfo.inputChallenges[_challengeNumber];
        address payTo = limboInputChallenge.from;
        require(payTo != address(0));
        delete limboExitInfo.inputChallenges[_challengeNumber];
        uint256 challengesLength = limboExitInfo.inputChallenges.length;
        uint256 outputBounty = 0;
        for (uint256 i = 0; i < limboExitInfo.outputs.length; i++) {
            if (limboExitInfo.outputs[i].isPegged) {
                outputBounty += WithdrawCollateral / challengesLength;
            }
        }
        payTo.transfer(WithdrawCollateral + outputBounty);
        return true;
    }

    // ----------------------------------

    function limboExitsDataInputChallenge(
        bytes22 _exitIndex,
        uint8 _challengeIndex
    ) view public returns (address from, uint8 inputNumber, bool resolved) {
        StructuresLibrary.LimboInputChallenge storage limboInputChallenge = limboExitsData[_exitIndex].inputChallenges[_challengeIndex];
        from = limboInputChallenge.from;
        inputNumber = limboInputChallenge.inputNumber;
        resolved = limboInputChallenge.resolved;
    }

    function limboExitsDataOutput(
        bytes22 _exitIndex,
        uint8 _outputIndex
    ) view public returns (uint256 amount, address owner, bool isPegged) {
        StructuresLibrary.LimboOutput storage limboOutput = limboExitsData[_exitIndex].outputs[_outputIndex];
        amount = limboOutput.amount;
        owner = limboOutput.owner;
        isPegged = limboOutput.isPegged;
    }

    // ----------------------------------
    function checkForValidityAndInclusion(
        uint32 _plasmaBlockNumber, // block with the transaction
        bytes _plasmaTransaction, // transaction itself
        bytes _merkleProof)
    internal view returns(PlasmaTransactionLibrary.PlasmaTransaction memory TX) {
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
            if (TX.inputs.length != 1 || TX.outputs.length != 1) {
                return false;
            }
            PlasmaTransactionLibrary.TransactionInput memory input = TX.inputs[0];
            return blockStorage.isOperator(TX.sender) && input.blockNumber == 0 && input.txNumberInBlock == 0 && input.outputNumberInTX == 0;
        } else if (TX.txType == TxTypeSplit || TX.txType == TxTypeMerge) {
            for (counter = 0; counter < TX.inputs.length; counter++) {
                balance = SafeMath.add(balance, TX.inputs[counter].amount);
            }
            for (counter = 0; counter < TX.outputs.length; counter++) {
                balance = SafeMath.sub(balance, TX.outputs[counter].amount);
            }
            if (balance != 0) {
                return false;
            }
            return true;
        }
        return false;
    }

}

