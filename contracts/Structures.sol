pragma solidity ^0.4.24;

library StructuresLibrary {
    struct ExitRecord {
        bytes32 transactionRef;
        //32 bytes
        uint256 amount;
        // 64 bytes
        address owner;
        uint64 timePublished;
        uint32 blockNumber;
        // 96 bytes
        uint32 transactionNumber;
        uint8 outputNumber;
        bool isValid;
        bool isLimbo;
        // 96 + 7 bytes
    }

    struct LimboData {
        LimboInputChallenge[] inputChallenges;
        LimboOutput[] outputs;
    }

    struct LimboInputChallenge {
        address from;
        uint8 inputNumber;
        bool resolved;
    }

    struct LimboOutput {
        uint256 amount;
        address owner;
        bool isPegged;
    }

    function getCompactExitRecordCommitment(ExitRecord self) internal pure returns(bytes22 commitment) {
        return bytes22(keccak256(abi.encodePacked(self.transactionRef, self.blockNumber, self.transactionNumber, self.outputNumber, self.isLimbo)));
    }
    
    function isFullyResolved(LimboData storage self) internal view returns (bool resolved) {
        for (uint8 i = 0; i < self.inputChallenges.length; i++) {
            if (self.inputChallenges[i].resolved == false) {
                return false;
            }
        }
        return true;
    }

    function addOutput(LimboData storage self, address _owner, uint256 _amount, bool _pegged) internal {
        LimboOutput memory newOutput;
        newOutput.owner = _owner;
        newOutput.amount = _amount;
        newOutput.isPegged = _pegged;
        self.outputs.push(newOutput);
    }
}