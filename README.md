# Plasma Parent Contract

## Description

This contract is used to maintain the integrity and correctness of Plasma by providing deposits, exits and limbo exits mechanism. It's based on a construction called More Viable Plasma, where in case of exit a priority of the transaction in the exit queue (so, priority of all outputs of this transaction) is assigned as the "age of the yongest input". In case of this implementation age is determined as a big-endian number made from byte concatenation of `BlockNumber|TransactionNumber|OutputNumber` of the UTXO being spent by the input. So age is first determined by smalled block number, then smaller transaction number in block, and then smaller output number in transaction. Priority is determined as the largest age and lower is better. Priority for exit purposes is capped and can not be better (smaller) than the age of block at `-1 week` timestamp.

To demonstrate why such priority is enough for proper limbo exit game (when block withholding happens and it's unknown what's happening in Plasma, so exits are done without a Merkle proof of inclusion in block) on can imagine a following situation:
- An operator does something malicious in block number `N` (like spend someone's else UTXO without knowing a private key) and withholds a block, but still publishes a header
- An operator can not start an exit directly from the block number `N` as he will be challenged by demonstrating a mismatch between transaction input and original UTXOs
- So an operator will have to make another block `N+1` (and withhold it) to start exits from it. There he puts a transaction that references an invalid transaction that was produced in block number `N`
- In this case a priority of malicious exiting transaction will be based on a block number `N`
- Any valid transaction from users (that can not be trivially challenged, since full information for a blocks `< N` is available) would have it's inputs from block with a number `<N`, so will have higher priority
- Through such procedure any user that would start an exit in timeframe of `1 week` (due to capped priority) after block `N` being committed to the smart-contract would exit normally

What is a Limbo exit procedure itself:
- User publishes a transaction without Merkle proof if inclusion
- User puts a bond on one of the outputs as a demontration of intent to exit and not being affraid of challenges
- Any other user can either challenge an exit or join it
- To challenge it's possible:
    - Put a bond on invalidity of a specific input. In this case an exitor would have to provide a full information about this input (by showing a transaction that has made the corresponding UTXO) or lose his bond
    - Directly show invalidity of the transaction input by:
        - Demonstrate that such input was already included in some transaction
        - Demonstrate that such input mismatches a corresponding UTXO (in case of data availability) 
        - Demonstrate that there exits some other transaction (no inclusion required) that has higher priority (uncapped)
- To join an exit user can put a bond on yet unbonded output to add it to the exit process
- If by the time the transaction should leave the queue all challenges on the inputs are resolved, then bonded outputs exit
- Otherwise transaction is deemed invalid and challengers have their bonds returned along with any output bonds evenly distributed

An **important note** about limbo exiting through the input bonding - there is no procedure to exit the limbo transaction's input! If user believes that limbo exit is invalid and wants to challenge one of the inputs (so he has a data about UTXOs being spent!) - he should just challenge inputs to prevent an exit and do a limbo exit of the transaction that makes this UTXOs.

## Transaction structure

Here we briefly describe the transaction structure, that is largely just an UTXO model with explicit enumeration of UTXO in the inputs

### Input
An RLP encoded set with the following items:
- Block number, 4 bytes
- Transaction number in block, 4 bytes
- Output number in transaction, 1 byte
- "Amount" field, 32 bytes, that is more a data field, usually used for an amount of the output referenced by previous field, but has special meaning for "Deposit" transactions

### Output
An RLP encoded set with the following items:
- Output number in transaction, 1 byte
- Receiver's Ethereum address, 20 bytes
- "Amount" field, 32 bytes

### Transaction 
An RLP encoded set with the following items:
- Transaction type, 1 byte
- An array (list) of Inputs, maximum 2 items
- An array (list) of Outputs, maximum 3 items. One of the outputs is an explicit output to an address of Plasma operator.

### Signed transaction 
An RLP encoded set with the following items:
- Transaction, as described above
- Recoverable EC of the transaction sender:
   1) V value, 1 byte, expected values 27, 28
   2) R value, 32 bytes
   3) S value, 32 bytes

From this signature Plasma operator deduces a sender, checks that the sender is an owner of UTXOs referenced by inputs. Signature is based on EthereumPersonalHash(RLPEncode(Transaction)). Transaction should be well-formed, sum of inputs equal to sum of the outputs, etc 

### Block header
- Block number, 4 bytes, used in the main chain to double check proper ordering
- Number of transactions in block, 4 bytes, purely informational
- Parent hash, 32 bytes, hash of the previous block, hashes the full header
- Merkle root of the transactions tree, 32 bytes
- V value, 1 byte, expected values 27, 28
- R value, 32 bytes
- S value, 32 bytes

Signature is based on EthereumPersonalHash(block number || number of transactions || previous hash || merkle root), where || means concatenation. Values V, R, S are then concatenated to the header.

### Block
- Block header, as described above, 137 bytes
- RLP encoded array (list) of signed transactions, as described above

While some fields can be excessive, such block header can be submitted by anyone to the main Ethereum chain when block is available, but for some reason not sent to the smart contract. Transaction numbering is done by the operator, it should be monotonically increasing without spaces and number of transactions in header should (although this is not necessary for the functionality) match the number of transactions in the Merkle tree and the full block.

## This contract differs from Minimal Viable Plasma in the following:

- Other transactions structure with nested RLP fields
- Deposit transactions are declarative: new block with 1 transaction is not created automatically (although can be easily changed), but deposit record is created and can be withdrawn back to user if Plasma operator doesn't provide transaction of appropriate structure (referencing this deposit, having proper owner and amount).
- Anyone(!) can send a header of the block to the main chain, so if block is assembled and available, but not yet pushed to the main chain, anyone can send a header on behalf of Plasma operator.

## Implemented functionality:

All basic challenges and potential "cheats" for operator or user should be now covered

## List of intended challenges and tests
- [x] Block header uploads
    - [x] should accept one properly signed header
    - [x] should NOT accept same header twice
    - [x] should accept two headers in right sequence
    - [x] should accept two headers in right sequence in the same transaction
    - [x] should NOT accept two headers in wrong sequence
    - [x] should NOT accept invalidly signed block header
    - [x] should NOT accept invalidly signed block header in sequence in one transaction
    - [x] should property update two weeks old block number
    - [x] should check block hashes match in addition to block numbers in sequence
- [x] Deposits
    - [x] should emit deposit event
    - [x] should allow deposit withdraw process
    - [x] should respond to deposit withdraw challenge
    - [x] should allow successful deposit withdraw
    - [x] should require bond for deposit withdraw start
    - [x] should stop Plasma on duplicate funding transaction
    - [x] should stop Plasma on funding without deposit
- [x] Normal exits
    - [x] should start an exit with proper proof
    - [x] should not allow non-owner of transaction to start a exit of UTXO
    - [x] should respond to withdraw challenge
    - [x] should allow successful withdraw
    - [x] should require bond for withdraw start 
    - [x] should return bond on successful withdraw
    - [x] should allow offer for buyout
    - [x] should allow accepting a buyout offer
    - [x] should allow returning funds for expired offer 
    - [x] should allow to publish a pre-signed buyout agreement 
- [x] Limbo exits
    - [x] should allow to start a limbo exit
    - [x] should allow to challenge an input using a bond
    - [x] should allow to join a limbo exit (bond the output)
    - [x] should maintain priority in the queue
    - [x] should give the same priority for blocks that are older than 1 week
    - [x] should allow to respond to the input challenge
    - [x] should allow to stop exit by publishing an "input already included" message
    - [x] should allow to stop exit by publishing a proof of mismatching UTXO -> input 
    - [x] should allow successful exit
- [x] Challenges
    - [x] Transaction in block references the future
    - [x] Transaction is malformed (balance breaking)
    - [x] Double spend
    - [x] Spend without owner signature
    - [x] UTXO amount is not equal to input amount
    - [x] UTXO was successfully withdrawn and than spent in Plasma

## Getting started

### Download dependecies:

```
git submodule init
git submodule update --recursive
```

## Contribution

Everyone is welcome to spot mistakes in the logic of this contract as number of provided functions is substantial. If you find a potential error or security loophole (one that would allow Plasma operator or user to break the normal operation and not being caught) - please open an issue.

## Authors

Alex Vlasov, [@shamatar](https://github.com/shamatar),  alex.m.vlasov@gmail.com

## Further work

Make optimizations for reduced gas costs for most of the functions.

## License

All source code and information in this repository is available under the Apache License 2.0 license.
