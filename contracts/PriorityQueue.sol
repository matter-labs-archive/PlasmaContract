pragma solidity ^0.4.24;

// original source from https://github.com/DavidKnott
// https://github.com/omisego/plasma-mvp/blob/master/plasma/root_chain/contracts/RootChain/RootChain.sol

import {SafeMath} from "./SafeMath.sol";

interface PriorityQueueInterface {
    function insert(uint72 _priority, bytes22 _partialHash) external;
    function minChild(uint256 i) view external returns (uint256);
    function getMin() external view returns (bytes22 partialHash);
    function delMin() external returns (bytes22 partialHash);
    function currentSize() external returns (uint256);
}

contract PriorityQueue {
    using SafeMath for uint256;
    /*
     *  Modifiers
     */
    modifier onlyOwner() {
        require(msg.sender == owner);
        _;
    }

    function setOwner (address _newOwner) onlyOwner public {
        require(_newOwner != address(0));
        owner = _newOwner;
    }

    /*
     *  Storage
     */

    struct QueueItem {
        uint72 priority;
        bytes22 partialHash;
        // 31 bytes
    }
    
    address public owner;
    QueueItem[] public heapList;
    uint256 public currentSize;

    constructor () public
    {
        owner = msg.sender;
        QueueItem memory item = QueueItem({
            priority: 0,
            partialHash: bytes22(0)
        });
        heapList.push(item);
        currentSize = 0;
    }

    function insert(uint72 _priority, bytes22 _index)
        public
        onlyOwner
    {
        heapList.push(QueueItem({
            priority: _priority,
            partialHash: _index
        }));
        currentSize = currentSize.add(1);
        percUp(currentSize);
    }

    function minChild(uint256 i)
        public
        view
        returns (uint256)
    {
        if (i.mul(2).add(1) > currentSize) {
            return i.mul(2);
        } else {
            if (heapList[i.mul(2)].priority < heapList[i.mul(2).add(1)].priority) {
                return i.mul(2);
            } else {
                return i.mul(2).add(1);
            }
        }
    }

    function getMin()
        public
        view
        returns (bytes22 index)
    {
        return heapList[1].partialHash;
    }

    function delMin()
        public
        onlyOwner
        returns (bytes22 partialHash)
    {
        require(currentSize > 0);
        partialHash = heapList[1].partialHash;
        heapList[1] = heapList[currentSize];
        delete heapList[currentSize];
        currentSize = currentSize.sub(1);
        percDown(1);
        return partialHash;
    }

    function percUp(uint256 j)
        private
    {   
        uint256 i = j;
        QueueItem memory tmp;
        while (i.div(2) > 0) {
            if (heapList[i].priority < heapList[i.div(2)].priority) {
                tmp = heapList[i.div(2)];
                heapList[i.div(2)] = heapList[i];
                heapList[i] = tmp;
            }
            i = i.div(2);
        }
    }

    function percDown(uint256 j)
        private
    {
        uint256 i = j;
        QueueItem memory tmp;
        while (i.mul(2) <= currentSize) {
            uint256 mc = minChild(i);
            if (heapList[i].priority > heapList[mc].priority) {
                tmp = heapList[i];
                heapList[i] = heapList[mc];
                heapList[mc] = tmp;
            }
            i = mc;
        }
    }
}