import depositABI from "@/utils/abis/deposit";
import ERC677ABI from "@/utils/abis/erc677";
import {
  CredentialType,
  DEPOSIT_TOKEN_AMOUNT_OLD,
  depositAmountBN,
  getCredentialType,
  MAX_BATCH_DEPOSIT,
} from "@/utils/constants";
import { ContractNetwork } from "@/utils/contracts";
import {
  DepositDataJson,
  generateDepositData,
  GET_DEPOSIT_EVENTS,
} from "@/utils/deposit";
import { useApolloClient } from "@apollo/client";
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, formatUnits } from "viem";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useWriteContracts } from "wagmi/experimental";
import useBalance from "./useBalance";

function useDeposit(
  contractConfig: ContractNetwork,
  address: `0x${string}`,
  chainId: number
) {
  const [deposits, setDeposits] = useState<DepositDataJson[][]>([]);
  const [credentialType, setCredentialType] = useState<CredentialType>();
  const [filename, setFilename] = useState("");
  const [totalDepositAmountBN, setTotalDepositAmountBN] = useState<bigint[]>([
    BigInt(0),
  ]);
  const { balance, refetchBalance } = useBalance(contractConfig, address);
  const {
    data: depositHash,
    error: contractError,
    writeContract,
  } = useWriteContract();
  const { isSuccess: depositSuccess, error: txError } =
    useWaitForTransactionReceipt({
      hash: depositHash,
    });
  const { writeContracts } = useWriteContracts();

  const apolloClient = useApolloClient();

  const validate = useCallback(
    async (deposits: DepositDataJson[], balance: bigint) => {
      let _credentialType: CredentialType | undefined;

      const isValidJson = deposits.every((d) =>
        [
          "pubkey",
          "withdrawal_credentials",
          "amount",
          "signature",
          "deposit_message_root",
          "deposit_data_root",
          "fork_version",
        ].every((key) => key in d)
      );
      if (!isValidJson) throw Error("Invalid JSON structure.");

      if (
        !deposits.every((d) => d.fork_version === contractConfig.forkVersion)
      ) {
        throw Error(`File is for the wrong network. Expected: ${chainId}`);
      }

      console.log(`The file has ${deposits.length} deposits.`);
      const pubkeys = deposits.map((d) => `0x${d.pubkey}`);
      const { data } = await apolloClient.query({
        query: GET_DEPOSIT_EVENTS,
        variables: {
          pubkeys: pubkeys,
          chainId: chainId,
        },
      });

      const existingDeposits = new Set(
        data.SBCDepositContract_DepositEvent.map(
          (d: { pubkey: string }) => d.pubkey
        )
      );

      const validDeposits = deposits.filter(
        (d) => !existingDeposits.has(`0x${d.pubkey}`)
      );

      if (validDeposits.length === 0)
        throw Error(
          "Deposits have already been made to all validators in this file."
        );

      if (validDeposits.length !== deposits.length) {
        // throw Error(
        //   "Some of the deposits have already been made to the validators in this file."
        // );
        console.warn(
          "Some of the deposits have already been made to the validators in this file. Only new deposits will be processed."
        );
      }

      const uniquePubkeys = new Set(validDeposits.map((d) => d.pubkey));
      if (uniquePubkeys.size !== validDeposits.length) {
        throw Error("Duplicated public keys detected in the deposit file.");
      }

      _credentialType = getCredentialType(deposits[0].withdrawal_credentials);
      if (!_credentialType) {
        console.log(deposits[0].withdrawal_credentials);
        throw Error("Invalid withdrawal credential type.");
      }

      if (
        !validDeposits.every((d) =>
          d.withdrawal_credentials.startsWith(_credentialType)
        )
      ) {
        throw Error(
          `All validators in the file must have the same withdrawal credentials of type ${_credentialType}`
        );
      }

      if (
        !validDeposits.every(
          (d) =>
            d.withdrawal_credentials === validDeposits[0].withdrawal_credentials
        )
      ) {
        throw Error(
          `All validators in the file must have the same withdrawal credential`
        );
      }

      if (
        (_credentialType === "00" || _credentialType === "01") &&
        !validDeposits.every(
          (d) => BigInt(d.amount) === BigInt(DEPOSIT_TOKEN_AMOUNT_OLD)
        )
      ) {
        throw Error("Amount should be exactly 32 tokens for deposits.");
      }

      const balanceRequired =
        (validDeposits.reduce((sum, d) => sum + BigInt(d.amount), BigInt(0)) /
          BigInt(DEPOSIT_TOKEN_AMOUNT_OLD)) *
        depositAmountBN;

      if (balance < balanceRequired) {
        console.warn(`Insufficient balance. ${formatUnits(
          balanceRequired,
          18
        )} GNO is required to process all deposits in the file. We are going to process only those who can be processed with the current balance.
      `);
        let cumBlance = BigInt(0);
        let lastIndex = 0;
        for (const d of validDeposits) {
          cumBlance +=
            (BigInt(d.amount) / BigInt(DEPOSIT_TOKEN_AMOUNT_OLD)) *
            depositAmountBN;
          if (balance >= cumBlance) {
            lastIndex++;
          } else {
            console.warn(
              `Skipping deposits starting after index ${lastIndex} due to insufficient balance.`
            );
            break;
          }
        }
        validDeposits.splice(lastIndex);
      }
      if (validDeposits.length === 0) {
        throw Error(
          "Insufficient balance to process any deposits in the file."
        );
      }

      const batchedDeposits: DepositDataJson[][] = [];
      const batchedTotalDepositAmountBN: bigint[] = [];
      const numOfBatches = Math.ceil(validDeposits.length / MAX_BATCH_DEPOSIT);
      for (let i = 0; i < numOfBatches; i++) {
        const batch = validDeposits.slice(
          i * MAX_BATCH_DEPOSIT,
          (i + 1) * MAX_BATCH_DEPOSIT
        );
        batchedDeposits.push(batch);
        batchedTotalDepositAmountBN.push(
          (batch.reduce((sum, d) => sum + BigInt(d.amount), BigInt(0)) /
            BigInt(DEPOSIT_TOKEN_AMOUNT_OLD)) *
            depositAmountBN
        );
      }

      return {
        deposits: batchedDeposits,
        _credentialType,
        _totalDepositAmountBN: batchedTotalDepositAmountBN,
      };
    },
    [contractConfig, apolloClient, chainId]
  );

  const setDepositData = useCallback(
    async (fileData: string, filename: string) => {
      setFilename(filename);
      if (fileData) {
        let data: DepositDataJson[] = [];
        try {
          data = JSON.parse(fileData);
        } catch (error) {
          throw Error(
            "Oops, something went wrong while parsing your json file. Please check the file and try again."
          );
        }
        if (balance === undefined) {
          throw Error("Balance not loaded correctly.");
        }
        const { deposits, _credentialType, _totalDepositAmountBN } =
          await validate(data, balance);
        setDeposits(deposits);
        setCredentialType(_credentialType);
        setTotalDepositAmountBN(_totalDepositAmountBN);
        return _credentialType;
      }
    },
    [validate, balance]
  );

  const deposit = useCallback(async () => {
    if (contractConfig) {
      // approve the GNO spending in favor of the deposit contract
      writeContract({
        address: contractConfig.addresses.token,
        abi: ERC677ABI,
        functionName: "approve",
        args: [
          contractConfig.addresses.deposit,
          totalDepositAmountBN.reduce((sum, amount) => sum + amount, BigInt(0)),
        ],
      });
      for (let i = 0; i < deposits.length; i++) {
        const {
          pubkeys,
          withdrawalCredentials,
          signatures,
          depositDataRoots,
          amounts,
        } = generateDepositData(deposits[i]);
        // batchDeposit the GNOs
        writeContract({
          address: contractConfig.addresses.deposit,
          abi: depositABI,
          functionName: "batchDeposit",
          args: [
            pubkeys,
            withdrawalCredentials,
            signatures,
            depositDataRoots,
            amounts,
          ],
        });
      }

      // should move refetchBalance to onDeposit function ?
      refetchBalance();
    }
  }, [
    contractConfig,
    credentialType,
    deposits,
    refetchBalance,
    totalDepositAmountBN,
    writeContract,
  ]);

  const depositSafeMsig = useCallback(async () => {
    if (contractConfig) {
      const txs: any[] = [
        {
          address: contractConfig.addresses.token,
          abi: ERC677ABI,
          functionName: "approve",
          args: [
            contractConfig.addresses.deposit,
            totalDepositAmountBN.reduce(
              (sum, amount) => sum + amount,
              BigInt(0)
            ),
          ],
        },
      ];

      for (let i = 0; i < deposits.length; i++) {
        const {
          pubkeys,
          withdrawalCredentials,
          signatures,
          depositDataRoots,
          amounts,
        } = generateDepositData(deposits[i]);
        // batchDeposit the GNOs
        console.log(
          "Batch deposit",
          i,
          pubkeys,
          withdrawalCredentials,
          signatures,
          depositDataRoots,
          amounts
        );
        txs.push({
          address: contractConfig.addresses.deposit,
          abi: depositABI,
          functionName: "batchDeposit",
          args: [
            pubkeys,
            withdrawalCredentials,
            signatures,
            depositDataRoots,
            amounts,
          ],
        });
      }
      console.log(txs);
      writeContracts({
        contracts: txs,
        chainId: 100,
      });
      // should move refetchBalance to onDeposit function ?
      refetchBalance();
    }
  }, [
    contractConfig,
    ,
    deposits,
    refetchBalance,
    totalDepositAmountBN,
    encodeFunctionData,
  ]);

  useEffect(() => {
    if (depositSuccess) {
      refetchBalance();
    }
  }, [depositSuccess, refetchBalance]);

  return {
    deposit,
    depositSafeMsig,
    depositSuccess,
    contractError,
    txError,
    depositHash,
    depositData: { deposits, filename, credentialType, totalDepositAmountBN },
    setDepositData,
  };
}

export default useDeposit;
