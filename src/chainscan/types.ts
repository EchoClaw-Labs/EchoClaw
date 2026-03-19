// Etherscan-style envelope
export interface EtherscanResponse<T> {
  status: string;  // "1" = success, "0" = error
  message: string; // "OK" or error description
  result: T;
}

// Custom endpoint envelope (NFT/Stats/Utils)
export interface CustomResponse<T> {
  status: number;  // 0 = success
  message: string;
  result: T;
}

// --- Account module ---

export interface ChainScanTx {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  nonce: string;
  blockHash: string;
  transactionIndex: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  isError: string;
  txreceipt_status: string;
  input: string;
  contractAddress: string;
  cumulativeGasUsed: string;
  gasUsed: string;
  confirmations: string;
}

export interface ChainScanTokenTransfer {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  nonce: string;
  blockHash: string;
  from: string;
  to: string;
  contractAddress: string;
  value: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  transactionIndex: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  cumulativeGasUsed: string;
  confirmations: string;
}

export interface ChainScanNftTransfer {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  nonce: string;
  blockHash: string;
  from: string;
  to: string;
  contractAddress: string;
  tokenID: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  transactionIndex: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  cumulativeGasUsed: string;
  confirmations: string;
}

export interface ChainScanBalanceMulti {
  account: string;
  balance: string;
}

// --- Transaction module ---

export interface ChainScanTxStatus {
  isError: string;
  errDescription: string;
}

export interface ChainScanTxReceipt {
  status: string;
}

// --- Contract module ---

export interface ChainScanContractSource {
  SourceCode: string;
  ABI: string;
  ContractName: string;
  CompilerVersion: string;
  OptimizationUsed: string;
  Runs: string;
  ConstructorArguments: string;
  EVMVersion: string;
  Library: string;
  LicenseType: string;
  Proxy: string;
  Implementation: string;
  SwarmSource: string;
}

export interface ChainScanContractCreation {
  contractAddress: string;
  contractCreator: string;
  txHash: string;
  blockNumber: string;
  timestamp: string;
}

// --- Decode (custom endpoints) ---

export interface ChainScanDecodedMethod {
  hash: string;
  abi: string;
  decodedData: string;
  error: string;
}

export interface ChainScanDecodedRaw {
  contract: string;
  input: string;
  abi: string;
  decodedData: string;
  error: string;
}

// --- Token stats (meme coin intel) ---

export interface ChainScanTokenHolderStat {
  statTime: string;
  holderCount: string;
}

export interface ChainScanTokenTransferStat {
  transferCount: string;
  userCount: string;
  statTime: string;
}

export interface ChainScanUniqueParticipantStat {
  statTime: string;
  uniqueParticipant: string;
}

export interface ChainScanTopAddress {
  address: string;
  value: string;
}

// --- Pagination options ---

export interface PaginationOpts {
  page?: number;
  offset?: number;
  sort?: "asc" | "desc";
  startblock?: number;
  endblock?: number;
}

export interface StatsPaginationOpts {
  skip?: number;
  limit?: number;
  sort?: "asc" | "desc";
  minTimestamp?: number;
  maxTimestamp?: number;
}
