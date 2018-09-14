pragma solidity ^0.4.24;

import {PlasmaTransactionLibrary} from "./PlasmaTransactionLibrary.sol";
import {PlasmaBlockStorageInterface} from "./PlasmaBlockStorage.sol";
import {PriorityQueueInterface} from "./PriorityQueue.sol";
import {StructuresLibrary} from "./Structures.sol";
import {SafeMath} from "./SafeMath.sol";

contract PlasmaChallenges {
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

    constructor() public {
    }
// ----------------------------------

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
// ----------------------------------

    function startDepositWithdraw(uint256 depositIndex) public payable returns (bool success) {
        require(msg.value == DepositWithdrawCollateral);
        DepositRecord storage record = depositRecords[depositIndex];
        require(record.status == DepositStatusDeposited);
        require(record.from == msg.sender);
        record.status = DepositStatusWithdrawStarted;
        record.withdrawStartedAt = block.timestamp;
        record.hasCollateral = true;
        emit DepositWithdrawStartedEvent(depositIndex);
        return true;
    }

    function finalizeDepositWithdraw(uint256 depositIndex) public returns (bool success) {
        DepositRecord storage record = depositRecords[depositIndex];
        require(record.status == DepositStatusWithdrawStarted);
        require(block.timestamp >= record.withdrawStartedAt + DepositWithdrawDelay);
        record.status = DepositStatusWithdrawCompleted;
        emit DepositWithdrawCompletedEvent(depositIndex);
        uint256 toSend = record.amount;
        if (record.hasCollateral) {
            toSend += DepositWithdrawCollateral;
        }
        record.from.transfer(toSend);
        return true;
    }

    function challengeDepositWithdraw(
        uint256 depositIndex,
        uint32 _plasmaBlockNumber,
        bytes _plasmaTransaction,
        bytes _merkleProof) 
        public 
        returns (bool success) {
        DepositRecord storage record = depositRecords[depositIndex];
        require(record.status == DepositStatusWithdrawStarted);
        PlasmaTransactionLibrary.PlasmaTransaction memory TX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_plasmaTransaction);
        (bool included, uint256 txNumber) = PlasmaTransactionLibrary.checkForInclusionIntoBlock(blockStorage.getMerkleRoot(_plasmaBlockNumber), _plasmaTransaction, _merkleProof);
        require(included);
        TX.txNumberInBlock = uint32(txNumber);
        require(TX.txType == TxTypeFund);
        require(blockStorage.isOperator(TX.sender));
        PlasmaTransactionLibrary.TransactionOutput memory output = TX.outputs[0];
        PlasmaTransactionLibrary.TransactionInput memory input = TX.inputs[0];
        require(output.recipient == record.from);
        require(output.amount == record.amount);
        require(input.amount == depositIndex);
        record.status = DepositStatusDepositConfirmed;
        emit DepositWithdrawChallengedEvent(depositIndex);
        if (record.hasCollateral) {
            msg.sender.transfer(DepositWithdrawCollateral);
        }
        return true;
    }

// ----------------------------------
// Double-spend related functions

// two transactions spend the same output
    function proveDoubleSpend(uint32 _plasmaBlockNumber1, //references and proves transaction number 1
                            uint8 _inputNumber1,
                            bytes _plasmaTransaction1,
                            bytes _merkleProof1,
                            uint32 _plasmaBlockNumber2, //references and proves transaction number 2
                            uint8 _inputNumber2,
                            bytes _plasmaTransaction2,
                            bytes _merkleProof2) public returns (bool success) {
        uint256 index1;
        uint256 index2;
        address signer1;
        address signer2;
        PlasmaTransactionLibrary.TransactionInput memory input1;
        PlasmaTransactionLibrary.TransactionInput memory input2;
        (signer1, input1, index1) = getTXinputDetailsFromProof(_plasmaBlockNumber1, _inputNumber1, _plasmaTransaction1, _merkleProof1);
        (signer2, input2, index2) = getTXinputDetailsFromProof(_plasmaBlockNumber2, _inputNumber2, _plasmaTransaction2, _merkleProof2);
        require(index1 != index2);
        require(signer1 != address(0));
        require(signer1 == signer2);
        require(input1.blockNumber == input2.blockNumber);
        require(input1.txNumberInBlock == input2.txNumberInBlock);
        require(input1.outputNumberInTX == input2.outputNumberInTX);
        if (_plasmaBlockNumber1 < _plasmaBlockNumber2) {
            setErrorAndLastFoundBlock(_plasmaBlockNumber2, true, msg.sender);
        } else {
            setErrorAndLastFoundBlock(_plasmaBlockNumber1, true, msg.sender);
        }
        return true;
    }

// transaction output is withdrawn and spent in Plasma chain
    function proveSpendAndWithdraw(
        uint32 _plasmaBlockNumber, //references and proves ownership on withdraw transaction
        bytes _plasmaTransaction,
        bytes _merkleProof,
        bytes _originatingPlasmaTransaction,
        bytes _originatingMerkleProof,
        uint8 _inputNumber,
        bytes22 _partialHash)
    public returns(bool success) {
        PlasmaTransactionLibrary.PlasmaTransaction memory spendingTX = checkForValidityAndInclusion(_plasmaBlockNumber, _plasmaTransaction, _merkleProof);
        PlasmaTransactionLibrary.TransactionInput memory spendingInput = spendingTX.inputs[_inputNumber];
        PlasmaTransactionLibrary.PlasmaTransaction memory exitedTX = checkForValidityAndInclusion(spendingInput.blockNumber, _originatingPlasmaTransaction, _originatingMerkleProof);
        StructuresLibrary.ExitRecord memory exitRecord;
        exitRecord.transactionRef = keccak256(_originatingPlasmaTransaction);
        exitRecord.blockNumber = spendingInput.blockNumber;
        exitRecord.transactionNumber = exitedTX.txNumberInBlock;
        exitRecord.outputNumber = spendingInput.outputNumberInTX;
        bytes22 exitRecordHash = StructuresLibrary.getCompactExitRecordCommitment(exitRecord);
        require(succesfulExits[exitRecordHash] == true);
        PlasmaTransactionLibrary.TransactionOutput memory exitedOutput = exitedTX.outputs[spendingInput.outputNumberInTX];
        require(spendingInput.outputNumberInTX == exitedOutput.outputNumberInTX);
        require(exitedTX.txNumberInBlock == spendingInput.txNumberInBlock);
        require(exitedOutput.recipient == spendingTX.sender);
        require(exitedOutput.amount == spendingInput.amount);
        setErrorAndLastFoundBlock(_plasmaBlockNumber, true, msg.sender);
        return true;
    }

    function proveInvalidDeposit(
        uint32 _plasmaBlockNumber, //references and proves transaction
        bytes _plasmaTransaction,
        bytes _merkleProof) 
    public returns (bool success) {
        PlasmaTransactionLibrary.PlasmaTransaction memory TX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_plasmaTransaction);
        (bool included, uint256 txNumber) = PlasmaTransactionLibrary.checkForInclusionIntoBlock(blockStorage.getMerkleRoot(_plasmaBlockNumber), _plasmaTransaction, _merkleProof);
        require(included);
        TX.txNumberInBlock = uint32(txNumber);
        require(isWellFormedDecodedTransaction(TX));
        require(TX.txType == TxTypeFund);
        PlasmaTransactionLibrary.TransactionOutput memory output = TX.outputs[0];
        PlasmaTransactionLibrary.TransactionInput memory input = TX.inputs[0];
        uint256 depositIndex = input.amount;
        // uint256 transactionIndex = PlasmaTransactionLibrary.makeInputOrOutputIndex(_plasmaBlockNumber, TX.txNumberInBlock, 0);
        DepositRecord storage record = depositRecords[depositIndex];
        if (record.status == DepositStatusNoRecord || record.amount != output.amount || record.from != output.recipient) {
            setErrorAndLastFoundBlock(_plasmaBlockNumber, true, msg.sender);
            return true;
        }
        revert();
        return false;
    }

    //prove double funding of the same

    function proveDoubleFunding(
        uint32 _plasmaBlockNumber1, //references and proves transaction number 1
        bytes _plasmaTransaction1,
        bytes _merkleProof1,
        uint32 _plasmaBlockNumber2, //references and proves transaction number 2
        bytes _plasmaTransaction2,
        bytes _merkleProof2) 
    public returns (bool success) {
        address signer1;
        uint256 depositIndex1;
        uint256 transactionIndex1;
        address signer2;
        uint256 depositIndex2;
        uint256 transactionIndex2;
        (signer1, depositIndex1, transactionIndex1) = getFundingTXdetailsFromProof(_plasmaBlockNumber1, _plasmaTransaction1, _merkleProof1);
        (signer2, depositIndex2, transactionIndex2) = getFundingTXdetailsFromProof(_plasmaBlockNumber2, _plasmaTransaction2, _merkleProof2);
        require(blockStorage.isOperator(signer1));
        require(blockStorage.isOperator(signer2));
        require(depositIndex1 == depositIndex2);
        require(transactionIndex1 != transactionIndex2);
        // require(checkDoubleFundingFromInternal(signer1, depositIndex1, transactionIndex1, signer2, depositIndex2, transactionIndex2));
        if (_plasmaBlockNumber1 < _plasmaBlockNumber2) {
            setErrorAndLastFoundBlock(_plasmaBlockNumber2, true, msg.sender);
        } else {
            setErrorAndLastFoundBlock(_plasmaBlockNumber1, true, msg.sender);
        }
        return true;
    }

// Prove that transaction in block references a block in future

    function proveReferencingInvalidBlock(uint32 _plasmaBlockNumber, //references and proves ownership on withdraw transaction
                            uint8 _plasmaInputNumberInTx,
                            bytes _plasmaTransaction,
                            bytes _merkleProof) public returns (bool success) {
        PlasmaTransactionLibrary.PlasmaTransaction memory TX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_plasmaTransaction);
        (bool included, uint256 txNumber) = PlasmaTransactionLibrary.checkForInclusionIntoBlock(blockStorage.getMerkleRoot(_plasmaBlockNumber), _plasmaTransaction, _merkleProof);
        require(included);
        TX.txNumberInBlock = uint32(txNumber);
        require(TX.isWellFormed);
        require(TX.inputs[_plasmaInputNumberInTx].blockNumber >= _plasmaBlockNumber);
        setErrorAndLastFoundBlock(_plasmaBlockNumber, true, msg.sender);
        return true;
    }

// Prove referencing a transaction that has a number larger, than number of transactions in block being referenced
// no longer valid with no explicit tx numbering
    // function proveReferencingInvalidTransactionNumber(uint32 _plasmaBlockNumber, //references and proves ownership on withdraw transaction
    //                         uint8 _plasmaInputNumberInTx,
    //                         bytes _plasmaTransaction,
    //                         bytes _merkleProof) public returns (bool success) {
    //     require(PlasmaTransactionLibrary.checkForInclusionIntoBlock(blockStorage.getMerkleRoot(_plasmaBlockNumber), _plasmaTransaction, _merkleProof));
    //     PlasmaTransactionLibrary.PlasmaTransaction memory TX = PlasmaTransactionLibrary.plasmaTransactionFromBytes(_plasmaTransaction);
    //     require(isWellFormedDecodedTransaction(TX));
    //     PlasmaTransactionLibrary.TransactionInput memory input = TX.inputs[_plasmaInputNumberInTx];
    //     uint32 blockNumber = input.blockNumber;
    //     uint32 numberOfTransactionsInBlock = blockStorage.getNumberOfTransactions(blockNumber);
    //     require(input.txNumberInBlock >= numberOfTransactionsInBlock);
    //     setErrorAndLastFoundBlock(_plasmaBlockNumber, true, msg.sender);
    //     return true;
    // }

// Prove that block inside itself has a transaction with a number larger, than number of transactions in block
// no longer valid with no explicit tx numbering
    // function proveBreakingTransactionNumbering(uint32 _plasmaBlockNumber, //references and proves ownership on withdraw transaction
    //                         bytes _plasmaTransaction,
    //                         bytes _merkleProof) public returns (bool success) {
    //     require(PlasmaTransactionLibrary.checkForInclusionIntoBlock(blockStorage.getMerkleRoot(_plasmaBlockNumber), _plasmaTransaction, _merkleProof));
    //     PlasmaTransactionLibrary.PlasmaTransaction memory TX = PlasmaTransactionLibrary.plasmaTransactionFromBytes(_plasmaTransaction);
    //     require(isWellFormedDecodedTransaction(TX));
    //     uint32 numberOfTransactionsInBlock = blockStorage.getNumberOfTransactions(_plasmaBlockNumber);
    //     require(TX.txNumberInBlock >= numberOfTransactionsInBlock);
    //     setErrorAndLastFoundBlock(_plasmaBlockNumber, true, msg.sender);
    //     return true;
    // }

// Prove two transactions in block with the same number
// no longer valid with no explicit tx numbering
    // function proveTwoTransactionsWithTheSameNumber(uint32 _plasmaBlockNumber, //references and proves ownership on withdraw transaction
    //                         bytes _plasmaTransaction0,
    //                         bytes _merkleProof0,
    //                         bytes _plasmaTransaction1,
    //                         bytes _merkleProof1
    //                         ) public returns (bool success) {
    //     require(PlasmaTransactionLibrary.checkForInclusionIntoBlock(blockStorage.getMerkleRoot(_plasmaBlockNumber), _plasmaTransaction0, _merkleProof0));
    //     require(PlasmaTransactionLibrary.checkForInclusionIntoBlock(blockStorage.getMerkleRoot(_plasmaBlockNumber), _plasmaTransaction1, _merkleProof1));
    //     PlasmaTransactionLibrary.PlasmaTransaction memory TX0 = PlasmaTransactionLibrary.plasmaTransactionFromBytes(_plasmaTransaction0);
    //     PlasmaTransactionLibrary.PlasmaTransaction memory TX1 = PlasmaTransactionLibrary.plasmaTransactionFromBytes(_plasmaTransaction1);
    //     require(isWellFormedDecodedTransaction(TX0));
    //     require(isWellFormedDecodedTransaction(TX1));
    //     require(TX0.txNumberInBlock == TX1.txNumberInBlock);
    //     setErrorAndLastFoundBlock(_plasmaBlockNumber, true, msg.sender);
    //     return true;
    // }


// Prove that either amount of the input doesn't match the amount of the output, or spender of the output didn't have an ownership

// Only operator have a power for such merges
    function proveBalanceOrOwnershipBreakingBetweenInputAndOutput(
        uint32 _plasmaBlockNumber, //references and proves ownership on withdraw transaction
        bytes _plasmaTransaction,
        bytes _merkleProof,
        uint32 _originatingPlasmaBlockNumber, //references and proves ownership on output of original transaction
        bytes _originatingPlasmaTransaction,
        bytes _originatingMerkleProof,
        uint256 _inputOfInterest)
    public returns(bool success) {
        uint256 idx = 0;
        PlasmaTransactionLibrary.PlasmaTransaction memory spendingTX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_plasmaTransaction);
        PlasmaTransactionLibrary.PlasmaTransaction memory originatingTX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_originatingPlasmaTransaction);
        (success, idx) = PlasmaTransactionLibrary.checkForInclusionIntoBlock(blockStorage.getMerkleRoot(_originatingPlasmaBlockNumber), _originatingPlasmaTransaction, _originatingMerkleProof);
        require(success);
        originatingTX.txNumberInBlock = uint32(idx);
        (success, idx) = PlasmaTransactionLibrary.checkForInclusionIntoBlock(blockStorage.getMerkleRoot(_plasmaBlockNumber), _plasmaTransaction, _merkleProof);
        require(success);
        spendingTX.txNumberInBlock = uint32(idx);
        success = checkRightfulInputOwnershipAndBalance(spendingTX, originatingTX, _originatingPlasmaBlockNumber, _inputOfInterest);
        require(!success);
        setErrorAndLastFoundBlock(_plasmaBlockNumber, true, msg.sender);
        return true;
    }

    function checkRightfulInputOwnershipAndBalance(
        PlasmaTransactionLibrary.PlasmaTransaction memory _spendingTX,
        PlasmaTransactionLibrary.PlasmaTransaction memory _originatingTX,
        uint32 _originatingPlasmaBlockNumber,
        uint256 _inputNumber) 
    internal view returns (bool isValid) {

        require(isWellFormedDecodedTransaction(_spendingTX));
        require(isWellFormedDecodedTransaction(_originatingTX));
        PlasmaTransactionLibrary.TransactionInput memory input = _spendingTX.inputs[_inputNumber];
        require(input.blockNumber == _originatingPlasmaBlockNumber);
        require(input.txNumberInBlock == _originatingTX.txNumberInBlock);
        if (input.outputNumberInTX >= _originatingTX.outputs.length) {
            return false;
        }
        PlasmaTransactionLibrary.TransactionOutput memory outputOfInterest = _originatingTX.outputs[uint256(input.outputNumberInTX)];
        if (outputOfInterest.amount != input.amount) {
            return false;
        }
        if (_spendingTX.txType == TxTypeSplit) {
            if (outputOfInterest.recipient != _spendingTX.sender) {
                return false;
            }
        } else if (_spendingTX.txType == TxTypeMerge) {
            if (outputOfInterest.recipient != _spendingTX.sender) {
                return false;
            }
        } else if (_spendingTX.txType == TxTypeFund) {
            return true;
        }
        return true;
    }


// ----------------------------------
// Convenience functions

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

    function getTXinputDetailsFromProof(
        uint32 _plasmaBlockNumber,
        uint8 _inputNumber,
        bytes _plasmaTransaction,
        bytes _merkleProof) 
        internal view returns (address signer, PlasmaTransactionLibrary.TransactionInput memory input, uint256 index) {
        
        PlasmaTransactionLibrary.PlasmaTransaction memory TX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_plasmaTransaction);
        (bool included, uint256 txNumber) = PlasmaTransactionLibrary.checkForInclusionIntoBlock(blockStorage.getMerkleRoot(_plasmaBlockNumber), _plasmaTransaction, _merkleProof);
        require(included);
        TX.txNumberInBlock = uint32(txNumber);
        require(isWellFormedDecodedTransaction(TX));
        require(TX.txType != TxTypeFund);
        require(TX.sender != address(0));
        require(TX.inputs.length > _inputNumber);
        input = TX.inputs[uint256(_inputNumber)];
        index = PlasmaTransactionLibrary.makeInputOrOutputIndex(_plasmaBlockNumber, TX.txNumberInBlock, _inputNumber);
        return (TX.sender, input, index);
    }

    function getFundingTXdetailsFromProof(
        uint32 _plasmaBlockNumber,
        bytes _plasmaTransaction,
        bytes _merkleProof) 
        internal view returns (address signer, uint256 depositIndex, uint256 outputIndex) {

        PlasmaTransactionLibrary.PlasmaTransaction memory TX = PlasmaTransactionLibrary.signedPlasmaTransactionFromBytes(_plasmaTransaction);
        (bool included, uint256 txNumber) = PlasmaTransactionLibrary.checkForInclusionIntoBlock(blockStorage.getMerkleRoot(_plasmaBlockNumber), _plasmaTransaction, _merkleProof);
        require(included);
        TX.txNumberInBlock = uint32(txNumber);
        require(isWellFormedDecodedTransaction(TX));
        require(TX.txType == TxTypeFund);
        PlasmaTransactionLibrary.TransactionInput memory auxInput = TX.inputs[0];
        require(auxInput.blockNumber == 0);
        require(auxInput.txNumberInBlock == 0);
        require(auxInput.outputNumberInTX == 0);
        depositIndex = auxInput.amount;
        outputIndex = PlasmaTransactionLibrary.makeInputOrOutputIndex(_plasmaBlockNumber, TX.txNumberInBlock, 0);
        return (TX.sender, depositIndex, outputIndex);
    }

    // ----------------------------------

    function() external payable{
        address callee = limboExitContract;
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
