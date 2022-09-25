# ethcanner
Etherium Scanner

This application reads 10 latest Blocks of ETH transactions from https://eth-rpc.gateway.pokt.network/.
Then it parses these transactions and generates the output JSON file in the data\ folder with the following interface:

```
export interface TokenChange {
  symbol: string;
  mint: string;
  preAmount: number; // Converted to decimals based on token information
  postAmount: number; // Converted to decimals based on token information
}

export interface BalanceChangeEvent {
  currencyString: string;
  accountAddress: string;
  accountAddressBlockchain: 2;
  currentNativeBalance: number; // Converted to decimals
  previousNativeBalance: number; // Converted to decimals
  transactionCost: number; // Converted to decimals
  blockHash?: string;
  sequenceNumber: number; // Block number
  changeSignature: string; // Transaction signature
  tokenChanges: TokenChange[];
}
```

Each run will generate a separate file wiht a different name.

This is a nodejs project. In order to run it, clone the repo, then:
```
npm install
```
and then 
```
node index.js
```