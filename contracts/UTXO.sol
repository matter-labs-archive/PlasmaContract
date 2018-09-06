pragma solidity ^0.4.24;

library StructuresLibrary {
    // struct UTXO {
    //     uint32 blockNumber;
    //     uint32 transactionNumber;
    //     uint8 inputOrOutputNumber;
    //     address owner;
    //     uint256 amount;
    // }

    // struct Transaction {
    //     bytes32[] inputCommitments;
    //     bytes32[] outputCommitments;
    //     uint32 blockNumber;
    //     uint32 transactionNumber;
    //     bool isLimbo;
    // }

    struct ExitRecord {
        bytes32 transactionRef;
        //32 bytes
        address owner;
        uint64 timePublished;
        uint32 blockNumber;
        // 64 bytes
        uint32 transactionNumber;
        uint8 outputNumber;
        bool isValid;
        // 64 + 6 bytes
        uint256 amount;
        // 96 + 6 bytes
    }

    // function getCompactCommitment(UTXO self) view internal returns (bytes32 commitment) {
    //     return keccak256(abi.encodePacked(self.blockNumber, self.transactionNumber, self.inputOrOutputNumber, self.owner, self.amount));
    // }

    // function getTransactionHash(Transaction self) view internal returns(bytes32 hash) {
    //     return keccak256(abi.encodePacked(self.blockNumber, self.transactionNumber, self.inputCommitments, self.outputCommitments, self.isLimbo));
    // }

    function getCompactExitRecordCommitment(ExitRecord self) pure internal returns(bytes32 commitment) {
        return keccak256(abi.encodePacked(self.transactionRef, self.blockNumber, self.transactionNumber, self.outputNumber));
    }
    // function checkForUTXOinclusionAsInput(Transaction self, UTXO utxo) internal view returns (uint256 inclusionIndex) {
    //     bytes32 commitment = getCompactCommitment(utxo);
    //     for (uint256 i = 0; i < self.inputCommitments.length; i++) {
    //         if (self.inputCommitments[i] == commitment) {
    //             return i;
    //         }
    //     }
    //     return uint256(-1);
    // }

    // function checkForUTXOinclusionAsOutput(Transaction self, UTXO utxo) internal view returns (uint256 inclusionIndex) {
    //     bytes32 commitment = getCompactCommitment(utxo);
    //     for (uint256 i = 0; i < self.outputCommitments.length; i++) {
    //         if (self.outputCommitments[i] == commitment) {
    //             return i;
    //         }
    //     }
    //     return uint256(-1);
    // }

}