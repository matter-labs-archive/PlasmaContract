pragma solidity ^0.4.24;

import {PlasmaTransactionLibrary} from "./PlasmaTransactionLibrary.sol";
import {PlasmaBlockStorageInterface} from "./PlasmaBlockStorage.sol";
import {PriorityQueueInterface} from "./PriorityQueue.sol";
import {StructuresLibrary} from "./Structures.sol";
import {SafeMath} from "./SafeMath.sol";

contract PlasmaBuyoutProcessor {
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
            revert("No deposits to the contracts!");
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

    function offerOutputBuyout(bytes22 _index, address _beneficiary) public payable returns (bool success) {
        require(msg.value > 0);
        require(_beneficiary != address(0));
        StructuresLibrary.ExitRecord storage exitRecord = exitRecords[_index];
        require(exitRecord.isValid);
        ExitBuyoutOffer storage offer = exitBuyoutOffers[_index];
        emit ExitBuyoutOffered(_index, _beneficiary, msg.value);
        require(!offer.accepted);
        address oldFrom = offer.from;
        uint256 oldAmount = offer.amount;
        require(msg.value > oldAmount);
        offer.from = _beneficiary;
        offer.amount = msg.value;
        if (oldFrom != address(0)) {
            oldFrom.transfer(oldAmount);
        }
        return true;
    }

    function acceptBuyoutOffer(bytes22 _index) public returns (bool success) {
        StructuresLibrary.ExitRecord storage exitRecord = exitRecords[_index];
        // this simple require solves accepting the already exited transaciton and validity :)
        require(exitRecord.isValid);
        ExitBuyoutOffer storage offer = exitBuyoutOffers[_index];
        require(offer.from != address(0));
        require(!offer.accepted);
        address oldBeneficiary = exitRecord.owner;
        uint256 offerAmount = offer.amount;
        offer.accepted = true;
        emit ExitBuyoutAccepted(_index, offer.from);
        oldBeneficiary.transfer(offerAmount);
        return true;
    }

    function returnExpiredBuyoutOffer(bytes22 _index) public returns (bool success) {
        ExitBuyoutOffer storage offer = exitBuyoutOffers[_index];
        require(!offer.accepted);
        // require(record.status != WithdrawStatusStarted || (block.timestamp >= record.timestamp + WithdrawDelay));
        address oldFrom = offer.from;
        uint256 oldAmount = offer.amount;
        require(msg.sender == oldFrom);
        delete exitBuyoutOffers[_index];
        oldFrom.transfer(oldAmount);
        return true;
    }

    function publishPreacceptedBuyout(
        bytes22 _index,
        uint256 _amount,
        address _beneficiary,
        uint8 v,
        bytes32 r, 
        bytes32 s
    ) public payable returns (bool success) {
        StructuresLibrary.ExitRecord storage exitRecord = exitRecords[_index];
        require(exitRecord.isValid, "Exit should be valid to accept a buyout");
        ExitBuyoutOffer storage offer = exitBuyoutOffers[_index];
        require(!offer.accepted, "Offer should not be prefiously accepted");
        bytes memory PersonalMessagePrefixBytes = "\x19Ethereum Signed Message:\n74"; // 22 of index + 32 of amount + 20 of address
        address signer = ecrecover(keccak256(abi.encodePacked(PersonalMessagePrefixBytes, _index, _amount, _beneficiary)), v, r, s);
        require(signer == exitRecord.owner, "Acceptance signer should be record owner");
        require(msg.value >= _amount, "Need to send at least the agreed amount");
        address oldFrom = offer.from;
        uint256 oldAmount = offer.amount;
        require(msg.value > oldAmount, "Should send more than any previous offer");
        offer.from = _beneficiary;
        offer.amount = msg.value;
        if (oldFrom != address(0)) {
            oldFrom.transfer(oldAmount);
        }
        offer.accepted = true;
        exitRecord.owner.transfer(_amount);
        emit ExitBuyoutAccepted(_index, _beneficiary);
        return true;
    }

// ----------------------------------

    function() external payable{
        address callee = challengesContract;
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
