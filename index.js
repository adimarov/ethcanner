
const converter = require("hex2dec");
const ethers = require('ethers');
const rpcUtils = require('./rpcUtils.js');
const logUtils = require('./logUtils')
const NUMBER_OF_BLOCKS = 10;

const main = async () => {
    try {
        //Log file has ETH transactions as a JSON array. This is just a sample, we can push those events to SQS queue, etc.
        await logUtils.initLogFile();
        //Reading the latest block, and will be moving forward 
        let block = await rpcUtils.getLatestBlock();
        //const block = await rpcUtils.getBlockByNumber('0xee3ca3');
        let blockCursor = parseInt(converter.hexToDec(block.number));
        //inisitalizing the memory hash for the contracts to save on RPC calls
        const contracts = new Map();
        //run blocks sequentially. in a bigger scale, we can consider parallel calls to speed things up.
        for (let i = blockCursor + 1; i <= blockCursor + NUMBER_OF_BLOCKS; i++) {
            if (block)
                await processBlock(block, contracts);
            block = await rpcUtils.getBlockByNumber(converter.decToHex(i.toString()));
            if(!block)
                console.log(`Error reading block ${converter.decToHex(i.toString())}`);
            
            //wait for 5 seconds, something with throttling?
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        await logUtils.closeLogFile();
    } catch (err) {
        console.error(err);
        await logUtils.logToFile(err);
        await logUtils.closeLogFile();
    }
}

const processBlock = async (block, contracts) => {
    console.log(`Reading block: ${block.number}`);
    //Work with ERC20 token transfers and ETH transfers only

    //Read balances of all From accounts by the Block Number ahead of time in parallel
    const transFromBalances = await readFromBalances(block);

    //ERC20 transfers first
    await processERC20Transactions(block, contracts, transFromBalances);

    //ETH native transactions
    await processETHTransactions(block, transFromBalances);
}

const readFromBalances = async (block) => {
    console.log(`Reading balances...`);
    //From balances will work for the both ETH and ERC20 transactions at the same time.
    const erc20TransandETHTrans = block.transactions.filter(t => t.input.startsWith('0xa9059cbb') || t.input === '0x').sort((a, b) => a.from > b.from);

    const transBalancePromises = [];
    for (let i in erc20TransandETHTrans) {
        const transaction = erc20TransandETHTrans[i];
        transBalancePromises.push(rpcUtils.getBalance(transaction.from, block.number));
    }

    const transBalances = await Promise.all(transBalancePromises);

    return transBalances;
}

const processERC20Transactions = async (block, contracts, transBalances) => {
    console.log(`Processing ERC20Transactions...`);
    let blockCursor = parseInt(converter.hexToDec(block.number));
    const blockCursorHex = block.number;

    //All ERC20 transactions
    const erc20Trans = block.transactions.filter(t => t.input.startsWith('0xa9059cbb')).sort((a, b) => a.from > b.from);
    console.log(`Reading ERC20 Receipts...`);
    //We will need all receipts, so we can call them ahead of time in parallel
    const erc20TransReceiptsPromises = [];
    for (let i in erc20Trans) {
        const transaction = erc20Trans[i];
        erc20TransReceiptsPromises.push(rpcUtils.getTransactionReceipt(transaction.hash));
    }

    const erc20TransReceipts = await Promise.all(erc20TransReceiptsPromises);

    //Process transactions one at a time
    for (let i in erc20Trans) {
        try {

            const transaction = erc20Trans[i];
            console.log(`Processing ERC20 Transaction ${transaction.hash}...`);
            const sender = transaction.from;

            const transReceipt = erc20TransReceipts.find(x => x.transactionHash && x.transactionHash === transaction.hash);
            const transactionCost = parseFloat(ethers.utils.formatEther(converter.hexToDec(transReceipt.effectiveGasPrice))) *
                parseFloat(converter.hexToDec(transReceipt.gasUsed));

            const signature = ethers.utils.joinSignature(transaction);
            let topicsFrom = [];
            let receiver = '';
            const toQueue = [];

            for (let k in transReceipt.logs) {
                const log = transReceipt.logs[k];
                //We only want to work with Transfer logs.
                if (log.topics.length === 3) {
                    console.log(`Processing ERC20 Transaction log ${log.logIndex}...`);
                    //we want to pad with 0 to the required length - 40. sometimes addresses can be just 0 and stripping trailing 0 makes it incorrect
                    const tokenFrom = ethers.utils.hexZeroPad(ethers.utils.hexStripZeros(log.topics[1]), 20);
                    const tokenTo = ethers.utils.hexZeroPad(ethers.utils.hexStripZeros(log.topics[2]), 20);
                    const contract = ethers.utils.hexZeroPad(ethers.utils.hexStripZeros(log.address), 20);
                    let meta = null;
                    if (!contracts.has(contract)) {
                        console.log(`Reading contract metadata from RPC ${contract}...`);
                        meta = await rpcUtils.getTokenMetadata(contract);
                        contracts.set(contract, meta);
                    }
                    else {
                        console.log(`Reading contract metadata from cache ${contract}...`);
                        meta = contracts.get(contract);
                    }
                    const value = converter.hexToDec(log.data);

                    if (tokenFrom !== tokenTo)
                        receiver = tokenTo;
                    topicsFrom.push(
                        {
                            symbol: meta.symbol,
                            mint: contract,
                            preAmount: parseFloat(ethers.utils.formatUnits(value, meta.decimals)), // Converted to decimals based on token information
                            postAmount: 0.0 // Converted to decimals based on token information
                        }
                    )
                    console.log(`Reading balance from To address ${receiver}, and block number ${blockCursorHex}...`);
                    const curBal = await rpcUtils.getBalance(receiver, blockCursorHex);

                    currentToBalance = parseFloat(ethers.utils.formatEther(converter.hexToDec(curBal.value)));

                    const BalanceChangeEventTo = {
                        currencyString: 'ETH',
                        accountAddress: receiver,
                        accountAddressBlockchain: 2,
                        //No changes to the Balance of the destination address?
                        currentNativeBalance: currentToBalance, // Converted to decimals
                        previousNativeBalance: currentToBalance, // Converted to decimals
                        transactionCost: transactionCost, // Converted to decimals
                        blockHash: block.hash,
                        sequenceNumber: blockCursor, // Block number
                        changeSignature: signature, // Transaction signature
                        tokenChanges: {
                            symbol: meta.symbol,
                            mint: contract,
                            preAmount: 0.0, // Converted to decimals based on token information
                            postAmount: parseFloat(ethers.utils.formatUnits(value, meta.decimals)) // Converted to decimals based on token information
                        }
                    }
                    toQueue.push(BalanceChangeEventTo);
                }
            }

            console.log(`Generating From record...`);
            const prevFromBalance = parseFloat(ethers.utils.formatEther(converter.hexToDec((transBalances.find(x => x.account === sender)).value)));

            const BalanceChangeEventFrom = {
                currencyString: 'ETH',
                accountAddress: transReceipt.from,
                accountAddressBlockchain: 2,
                currentNativeBalance: prevFromBalance - transactionCost, // Converted to decimals
                previousNativeBalance: prevFromBalance, // Converted to decimals
                transactionCost: transactionCost, // Converted to decimals
                blockHash: block.hash,
                sequenceNumber: blockCursor, // Block number
                changeSignature: signature, // Transaction signature
                tokenChanges: topicsFrom
            }
            console.log(`Writing transaction to the log File...`);

            await logUtils.logToFile(BalanceChangeEventFrom);
            toQueue.forEach(async (x) => {
                await logUtils.logToFile(x);
            });
            console.log(`Transaction ${transaction.hash} is finished...`);
        }
        catch (err) {
            throw err;
        }
    }
}

const processETHTransactions = async (block, transBalances) => {

    console.log(`Processing ETH transactions...`);

    let blockCursor = parseInt(converter.hexToDec(block.number));
    const ethTrans = block.transactions.filter(t => t.input === '0x').sort((a, b) => a.from > b.from);

    console.log(`Processing ETH transactions To Balances...`);
    //For simple Ethereum transfers we need to prepare balances for the receivers in parallel and ahead of calculations
    const transBalanceToPromises = [];
    for (let i in ethTrans) {
        const transaction = ethTrans[i];
        transBalanceToPromises.push(rpcUtils.getBalance(transaction.to, ethers.utils.hexValue(blockCursor - 1)));
    }

    const transToBalances = await Promise.all(transBalanceToPromises);

    //ETH transactions
    for (let i in ethTrans) {
        try {
            const transaction = ethTrans[i];
            console.log(`Processing ETH transaction ${transaction.hash}...`);
            const sender = transaction.from;
            const receiver = transaction.to;
            const amount = parseFloat(ethers.utils.formatEther(converter.hexToDec(transaction.value)));

            const signature = ethers.utils.joinSignature(transaction);

            const transactionCost = parseFloat(ethers.utils.formatEther(converter.hexToDec(transaction.gasPrice))) * parseFloat(converter.hexToDec(transaction.gas));

            const fromBalance = parseFloat(ethers.utils.formatEther(converter.hexToDec((transBalances.find(x => x.account === sender)).value)));

            const toBalance = parseFloat(ethers.utils.formatEther(converter.hexToDec((transToBalances.find(x => x.account === receiver)).value)));

            const BalanceChangeEventFrom = {
                currencyString: 'ETH',
                accountAddress: sender,
                accountAddressBlockchain: 2,
                currentNativeBalance: fromBalance - transactionCost - amount, // Converted to decimals
                previousNativeBalance: fromBalance, // Converted to decimals
                transactionCost: transactionCost, // Converted to decimals
                blockHash: block.hash,
                sequenceNumber: blockCursor, // Block number
                changeSignature: signature, // Transaction signature
                tokenChanges: []
            }

            const BalanceChangeEventTo = {
                currencyString: 'ETH',
                accountAddress: receiver,
                accountAddressBlockchain: 2,
                currentNativeBalance: toBalance + amount, // Converted to decimals
                previousNativeBalance: toBalance, // Converted to decimals
                transactionCost: transactionCost, // Converted to decimals
                blockHash: block.hash,
                sequenceNumber: blockCursor, // Block number
                changeSignature: signature, // Transaction signature
                tokenChanges: []
            }
            await logUtils.logToFile(BalanceChangeEventFrom);
            await logUtils.logToFile(BalanceChangeEventTo);
            console.log(`ETH transaction ${transaction.hash} is processed...`);
        }
        catch (err) {
            throw err;
        }
    }
}

main();


