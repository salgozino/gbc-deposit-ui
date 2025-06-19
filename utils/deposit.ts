// NOTE: Ideally this should use { assert: { type: 'json' } },
// but this would require significant changes in the build process

import { gql } from "@apollo/client";
import { Address } from "viem";
import { DEPOSIT_TOKEN_AMOUNT_OLD, depositAmountBN } from "./constants";

type DepositData = {
  lastBlock: bigint;
  deposits: Address[];
};

export type DepositDataJson = {
  pubkey: string;
  withdrawal_credentials: string;
  amount: bigint;
  signature: string;
  deposit_message_root: string;
  deposit_data_root: string;
  fork_version: string;
};

export type BatchDepositInputs = {
  pubkeys: `0x${string}`;
  withdrawalCredentials: `0x${string}`;
  signatures: `0x${string}`;
  depositDataRoots: `0x${string}`[];
  amounts: bigint[];
}

export async function loadCachedDeposits(chainId: number, depositStartBlockNumber: bigint): Promise<DepositData> {
  try {
    const {
      deposits = [],
      lastBlock = depositStartBlockNumber,
    } = await import(`../data/${chainId}/deposits.json`);
    return { deposits, lastBlock };
  } catch (err) {
    console.error(err);
  }

  return {
    lastBlock: depositStartBlockNumber,
    deposits: [],
  };
}

export const generateDepositData = (deposits: DepositDataJson[]): BatchDepositInputs => {
  // The withdrawal credentials are the same for all deposits in a batch
  // This is validated in the hook
  const withdrawalCredentials: `0x${string}` = `0x${deposits[0].withdrawal_credentials}`;
  
  let pubkeys: `0x${string}` = '0x';
  let signatures: `0x${string}` = '0x';
  let depositDataRoots: `0x${string}`[] = [];
  let amounts: bigint[] = [];

  deposits.forEach((deposit) => {
    pubkeys += deposit.pubkey;
    signatures += deposit.signature;
    depositDataRoots.push(`0x${deposit.deposit_data_root}`);
    // amount / 32 * 1, because, now in batchDeposit we use 1 ETH per validator, not 32 as in transferAndCall
    amounts.push(BigInt(deposit.amount) / BigInt(DEPOSIT_TOKEN_AMOUNT_OLD) * depositAmountBN);
  });

  return { pubkeys, withdrawalCredentials, signatures, depositDataRoots, amounts };
};

export const GET_DEPOSIT_EVENTS = gql`
query MyQuery($pubkeys: [String!], $chainId: Int!) {
  SBCDepositContract_DepositEvent(
    where: { 
      pubkey: { 
        _in: $pubkeys
      },
      chainId: {_eq: $chainId}
    }
  ) {
    id
    amount
    db_write_timestamp
    index
    withdrawal_credentials
    pubkey
  }
}
`;
