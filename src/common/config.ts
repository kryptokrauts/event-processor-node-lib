import dotenv from 'dotenv';
import { KafkaConfig, logLevel } from 'kafkajs';
import { Logger, pino } from 'pino';

dotenv.config();

export const EOSIO_CONFIG = {
  start_block: Number(process.env.EOSIO_START_BLOCK),
  log_head_diff: Boolean(process.env.EOSIO_LOG_HEAD_DIFF),
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
