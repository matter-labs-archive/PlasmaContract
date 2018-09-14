pragma solidity ^0.4.24;

import {PlasmaTransactionLibrary} from "./PlasmaTransactionLibrary.sol";
import {PlasmaBlockStorageInterface} from "./PlasmaBlockStorage.sol";
import {PriorityQueueInterface} from "./PriorityQueue.sol";
import {StructuresLibrary} from "./Structures.sol";
import {SafeMath} from "./SafeMath.sol";

contract PlasmaParent {
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

    uint256 public DepositWithdrawCollateral = 50000000000000000;
    uint256 public WithdrawCollateral = 50000000000000000;
    uint256 public constant DepositWithdrawDelay = (72 hours);
    uint256 public constant InputChallangesDelay = (72 hours);
    uint256 public constant OutputChallangesDelay = (72 hours);
    uint256 public constant ExitDelay = (144 hours);

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

    uint8 constant UTXOstatusNull = 0;
    uint8 constant UTXOstatusUnspent = 1;
    uint8 constant UTXOstatusSpent = 2;

    uint8 constant ExitStatusNull = 0;
    uint8 constant ExitStatusWaitingForInputChallenges = 1;
    uint8 constant ExitStatusWaitingForOutputChallenges = 2;

    mapping(bytes22 => StructuresLibrary.ExitRecord) public exitRecords;
    mapping(bytes22 => StructuresLibrary.LimboData) limboExitsData;
    mapping(bytes22 => bool) public succesfulExits;

    event ErrorFoundEvent(uint256 indexed _lastValidBlockNumber);

    event DepositEvent(address indexed _from, uint256 indexed _amount, uint256 indexed _depositIndex);
    event DepositWithdrawStartedEvent(uint256 indexed _depositIndex);
    event DepositWithdrawChallengedEvent(uint256 indexed _depositIndex);
    event DepositWithdrawCompletedEvent(uint256 indexed _depositIndex);

    event TransactionPublished(bytes32 indexed _hash, bytes _data);
    event ExitRecordCreated(bytes22 indexed _hash);
    event ExitChallenged(bytes22 indexed _hash);
    event TransactionIsPublished(uint64 indexed _index);
    event ExitStartedEvent(address indexed _from, uint72 _priority, uint72 indexed _index, bytes22 indexed _hash);

    event LimboExitStartedEvent(address indexed _from, uint72 indexed _priority, bytes22 indexed _partialHash);
    event ExitBuyoutOffered(bytes22 indexed _partialHash, address indexed _from, uint256 indexed _buyoutAmount);
    event ExitBuyoutAccepted(bytes22 indexed _partialHash, address indexed _from);    
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

    function setDelegates(address _buyouts, address _challenger, address _limboExit) public returns (bool success) {
        require(msg.sender == owner);
        require(_buyouts != address(0));
        require(_challenger != address(0));
        require(_limboExit != address(0));
        require(buyoutProcessorContract == address(0));
        require(challengesContract == address(0));
        require(limboExitContract == address(0));
        buyoutProcessorContract = _buyouts;
        limboExitContract = _limboExit;
        challengesContract = _challenger;
        return true;
    }

    // function setErrorAndLastFoundBlock(uint32 _invalidBlockNumber, bool _transferReward, address _payTo) internal returns (bool success) {
    //     if (!plasmaErrorFound) {
    //         plasmaErrorFound = true;
    //     }
    //     if (lastValidBlock == 0) {
    //         lastValidBlock = _invalidBlockNumber-1;
    //     } else {
    //         if(lastValidBlock >= _invalidBlockNumber) {
    //             lastValidBlock = _invalidBlockNumber-1;
    //         }
    //     }
    //     blockStorage.incrementWeekOldCounter();
    //     emit ErrorFoundEvent(lastValidBlock);
    //     if (operatorsBond != 0) {
    //         uint256 bond = operatorsBond;
    //         operatorsBond = 0;
    //         if (_transferReward) {
    //             address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF).transfer(bond / 2);
    //             _payTo.transfer(bond / 2);
    //         }
    //     }
    //     return true;
    // }

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

    function incrementWeekOldCounter() public adjustsTime {

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
        bytes22 exitRecordHash = StructuresLibrary.getCompactExitRecordCommitment(exitRecord);
        require(exitRecords[exitRecordHash].transactionRef == bytes32(0));
        exitRecords[exitRecordHash] = exitRecord;
        emit TransactionPublished(transactionHash, _plasmaTransaction);
        scratchSpace[2] = PlasmaTransactionLibrary.makeInputOrOutputIndex(_plasmaBlockNumber, TX.txNumberInBlock, _outputNumber);
        emit ExitStartedEvent(msg.sender, scratchSpace[0], scratchSpace[2], exitRecordHash);
        emit ExitRecordCreated(exitRecordHash);
        require(msg.value == WithdrawCollateral);
        exitQueue.insert(scratchSpace[0], exitRecordHash);
        allExitsForUser[msg.sender].push(exitRecordHash);
        return true;
    }

    function challengeNormalExitByShowingExitBeingSpent(
        bytes22 _exitRecordHash,
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
        bytes22 _exitRecordHash,
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
        // to prevent challenging by the same transaction
        require(exitRecord.blockNumber != _plasmaBlockNumber || exitRecord.transactionNumber != TX.txNumberInBlock);
        // check the validity, that inputs match
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
        bytes22 _exitRecordHash,
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

    function finalizeExits(uint256 _numOfExits) public returns (bool success) {
        uint256 toSend = 0;
        address beneficiary = address(0);
        bool result = false;
        for (uint i = 0; i < _numOfExits; i++) {
            bytes22 index = exitQueue.delMin();
            result = attemptExit(index);
            if (!result) {
                if (i == 0) {
                    revert(); // save some gas
                } else {
                    break; // priority did not mature
                }
            }
            delete exitRecords[index];
            if (exitQueue.currentSize() > 0) {
                toSend = 0;
                beneficiary = address(0);
                result = false;
            } else {
                break;
            }
        }
        return true;
    }

    function attemptExit(bytes22 _index) internal returns (bool success){
        StructuresLibrary.ExitRecord storage exitRecord = exitRecords[_index];
        if (!exitRecord.isValid) {
            return true;
        }
        if (exitRecord.timePublished + ExitDelay > block.timestamp) {
            return false;
        }
        if (exitRecord.isLimbo) {
            return attemptLimboExit(_index);
        }
        address beneficiary = exitRecord.owner;
        ExitBuyoutOffer storage offer = exitBuyoutOffers[_index];
        if (offer.accepted) {
            beneficiary = offer.from;
            delete exitBuyoutOffers[_index];
        }
        uint256 toSend = exitRecord.amount + WithdrawCollateral;
        succesfulExits[_index] = true;
        // we use send so some malicious contract does not stop the queue from exiting
        beneficiary.send(toSend);
        return true;
    }

    function attemptLimboExit(bytes22 _index) internal returns (bool success) {
        // we have already pre-checked validity and time, now just do the exit by checking that all input challenges are resolved
        StructuresLibrary.LimboData storage limboData = limboExitsData[_index];
        if (!StructuresLibrary.isFullyResolved(limboData)) {
            return false;
        }
        StructuresLibrary.LimboOutput memory output;
        address beneficiary;
        uint256 amount;
        for (uint8 i = 0; i < limboData.outputs.length; i++) {
            output = limboData.outputs[i];
            if (output.isPegged) {
                continue;
            }
            beneficiary = output.owner;
            amount = output.amount;
            delete limboData.outputs[i];
            // we use send so some malicious contract does not stop the queue from exiting
            beneficiary.send(amount);
        }
        succesfulExits[_index] = true;
        return true;
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
        address callee = buyoutProcessorContract;
        assembly {
            let memoryPointer := mload(0x40)
            calldatacopy(memoryPointer, 0, calldatasize)
            let newFreeMemoryPointer := add(memoryPointer, calldatasize)
            mstore(0x40, newFreeMemoryPointer)
            let retVal := delegatecall(sub(gas, 2000), callee, memoryPointer, calldatasize, newFreeMemoryPointer, 0x40)
            let retDataSize := returndatasize
            returndatacopy(newFreeMemoryPointer, 0, retDataSize)
            switch retVal case 0 { revert(0,0) } default { return(newFreeMemoryPointer, retDataSize) }
        }
    }

}
