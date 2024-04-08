import dotenv from 'dotenv';
import { KafkaConfig, logLevel } from 'kafkajs';
import { Logger, pino } from 'pino';

dotenv.config();

export const control_api_port = process.env.PORT || 8000;
export const sync_message_block_interval = Number(process.env.SYNC_MESSAGE_BLOCK_INTERVAL || 60);

export const EOSIO_CONFIG = {
  start_block: Number(process.env.EOSIO_START_BLOCK),
  eosio_node_api: process.env.EOSIO_NODE_API,
  eosio_ship_api: process.env.EOSIO_SHIP_API,
  ds_threads: Number(process.env.EOSIO_DS_THREADS || 4),
  max_messages_in_flight: Number(process.env.EOSIO_MAX_MESSAGES_IN_FLIGHT || 50),
  fetch_block: process.env.EOSIO_FETCH_BLOCK !== 'false',
  fetch_traces: process.env.EOSIO_FETCH_TRACES !== 'false',
  fetch_deltas: process.env.EOSIO_FETCH_DELTAS !== 'false',
  num_blocks_to_finality: Number(process.env.EOSIO_NUM_BLOCKS_TO_FINALITY || 180),
};

export const KAFKA_CONFIG: KafkaConfig = {
  clientId: process.env.KAFKA_CLIENT_ID,
  brokers: process.env.KAFKA_BROKERS.split(','),
  connectionTimeout: Number(process.env.KAFKA_CONNECTION_TIMEOUT),
  logLevel: logLevel[process.env.KAFKA_LOG_LEVEL],
  retry: {
    retries: Number(process.env.KAFKA_RETRY_RETRIES || 5),
  },
};

export const KAFKA_TOPIC_CONFIG = {
  contract_topic: process.env.KAFKA_CONTRACT_TOPIC,
  contract_topic_partition: Number(process.env.KAFKA_CONTRACT_TOPIC_PARTITION || 0),
  contract_consumer_group_id: process.env.KAFKA_CONTRACT_CONSUMER_GROUP_ID,
  contract_topic_acks: Number(process.env.KAFKA_CONTRACT_TOPIC_ACKS),
};

export function getLogger(name: string): Logger {
  return pino({
    name: name,
    level: process.env.LOG_LEVEL,
  });
}
