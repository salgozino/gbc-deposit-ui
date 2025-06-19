// NOTE: Ideally this should use { assert: { type: 'json' } },
// but this would require significant changes in the build process

import { gql } from "@apollo/client";
import { Address } from "viem";

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
  let pubkeys: `0x${string}` = '0x';
  let withdrawalCredentials: `0x${string}` = '0x';
  let signatures: `0x${string}` = '0x';
  let depositDataRoots: `0x${string}`[] = [];
  let amounts: bigint[] = [];

  deposits.forEach((deposit) => {
    withdrawalCredentials += deposit.withdrawal_credentials;
    pubkeys += deposit.pubkey;
    signatures += deposit.signature;
    depositDataRoots.push(`0x${deposit.deposit_data_root}`);
    amounts.push(deposit.amount);
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
