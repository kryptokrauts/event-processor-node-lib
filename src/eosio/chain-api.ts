import 'dotenv/config';
import { RpcInterfaces } from 'eosjs';
import fetch from 'node-fetch';

export const getHeadBlockNum = () =>
  fetch(`${process.env.EOSIO_NODE_API}/v1/chain/get_info`)
    .then(res => res.json())
    .then(res => res.head_block_num);

export const fetchAbi = (account_name: string) =>
  fetch(`${process.env.EOSIO_NODE_API}/v1/chain/get_abi`, {
    method: 'POST',
    body: JSON.stringify({
      account_name,
    }),
  }).then(async res => {
    const response = await res.json();
    return {
      account_name,
      abi: response.abi as RpcInterfaces.Abi,
    };
  });
