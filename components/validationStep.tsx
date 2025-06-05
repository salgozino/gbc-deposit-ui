import { CheckIcon } from '@heroicons/react/16/solid';
import { DepositDataJson } from '@/utils/deposit';
import { CredentialType } from '@/utils/constants';
import { depositAmountBN } from '@/hooks/useDeposit';

interface ValidationStepProps {
  depositData: {
    deposits: DepositDataJson[][];
    filename: string;
    credentialType: CredentialType | undefined;
    totalDepositAmountBN: bigint[];
  };
  onDeposit: () => Promise<void>;
}

export function ValidationStep({
  depositData,
  onDeposit,
}: ValidationStepProps) {

  return (
    <div className='w-full flex flex-col items-center'>
      <div id='filename'>{depositData.filename}</div>
      <div className='flex items-center mt-4'>
        <CheckIcon className='h-5 w-5' /> Accepted
      </div>
      <div className='flex items-center'>
        <CheckIcon className='h-5 w-5' /> Batches of deposits:{' '}
        {depositData.deposits.length}
      </div>
      <div className='flex items-center'>
        <CheckIcon className='h-5 w-5' /> Validator deposits per batch:{' '}
        {depositData.deposits.map(batch => batch.length).join(', ')}
      </div>
      <div className='flex items-center'>
        <CheckIcon className='h-5 w-5' /> Total validators to be deployed:{' '}
        {depositData.deposits.reduce((a, b) => a + b.length, 0)}
      </div>
      <div className='flex items-center'>
        <CheckIcon className='h-5 w-5' /> Total amount required:{' '}
        {depositData.totalDepositAmountBN.reduce((a, b) => a + b, 0n) / depositAmountBN} GNO
      </div>
      <button
        className='bg-accent px-4 py-1 rounded-full text-white mt-4 text-lg font-semibold'
        onClick={() => onDeposit()}
        id='depositButton'
      >
        Deposit
      </button>
    </div>
  );
}
