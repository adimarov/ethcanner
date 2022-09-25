const axios = require('axios');
const ethers = require('ethers');
const WEB3_ENDPOINT = 'https://eth-rpc.gateway.pokt.network/';

const handleError = () => {
    return undefined;
};

const getTokenMetadata = async (address) => {
    const abi = [
      'function name() view returns (string name)',
      'function symbol() view returns (string symbol)',
      'function decimals() view returns (uint8 decimals)',
    ];
    const { JsonRpcProvider } = ethers.providers;
    const provider = new JsonRpcProvider(WEB3_ENDPOINT);
    const contract = new ethers.Contract(address, abi, provider);
    const [name, symbol, decimals] = await Promise.all([
      contract.name().catch(handleError),
      contract.symbol().catch(handleError),
      contract.decimals().catch(handleError),
    ]);
    return { decimals, name, symbol };
  };

const getLatestBlock = async () => {
    try {
        const request = {
            jsonrpc: "2.0",
            method: "eth_getBlockByNumber",
            params: [
                "latest", 
                true
            ],
            id:1
        };
        const rest = await axios.post(WEB3_ENDPOINT, request);
        if(rest.data.error)
        {
            console.error(rest.data.error.message);
            return null;
        }
        return rest.data.result;
    } catch (err) {
        console.error(err);
    }
};

const getBlockByNumber = async (hexNumber) => {
    try {
        const request = {
            jsonrpc: "2.0",
            method: "eth_getBlockByNumber",
            params: [
                hexNumber, 
                true
            ],
            id:1
        };
        const rest = await axios.post(WEB3_ENDPOINT, request);
        if(rest.data.error || !rest.data.result)
        {
            console.error(rest.data.error.message);
            return null;
        }
        //Sometimes the result is just empty. 
        if(!rest.data.result)
        {
            console.error('Empty result');
            return null;
        }
        return rest.data.result;
    } catch (err) {
        console.error(err);
    }
};

const getTransactionReceipt = async (transactionHash) => {
    try {
        const request = {
                jsonrpc: "2.0",
                method: "eth_getTransactionReceipt",
                params:[
                    transactionHash
                ],
                id:1
        };
        const rest = await axios.post(WEB3_ENDPOINT, request);
        if(rest.data.error)
        {
            console.error(rest.data.error.message);
            return null;
        }
        return rest.data.result;
    } catch (err) {
        console.error(err);
    }
};

const getBalance = async (account, blockHex) => {
    try {
        const request = {
            jsonrpc:"2.0",
            method:"eth_getBalance",
            params:[
                account, 
                blockHex
            ],
            id:1
        };
        const rest = await axios.post(WEB3_ENDPOINT, request);
        if(rest.data.error)
        {
            console.error(rest.data.error.message);
            return {account: account, value: '0x0'};
        }
        if(rest.data.result === 0)
            return {account: account, value: '0x0'};    
        return {account: account, value: rest.data.result};
    } catch (err) {
        console.error(err);
        return {account: account, value: '0x0'};
    }
};

module.exports = {getTokenMetadata, getLatestBlock, getTransactionReceipt, getBalance, getBlockByNumber}