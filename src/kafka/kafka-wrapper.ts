import { Admin, Consumer, Kafka, Producer, SeekEntry } from 'kafkajs';
import { KAFKA_CONFIG, KAFKA_TOPIC_CONFIG, getLogger } from '../common/config';
import { KafkaWrapperConfig, ResetInfo } from '../common/types';

// append kafka clientId as context information to every logged message
const logger = getLogger('kafka-wrapper');

class KafkaWrapper {
  config: KafkaWrapperConfig = undefined;
  kafka: Kafka = undefined;
  producer: Producer = undefined;
  admin: Admin = undefined;
  contractTopicConsumer: Consumer = undefined;

  constructor(config: KafkaWrapperConfig) {
    this.config = config;
    this.kafka = new Kafka(KAFKA_CONFIG);
    this.admin = this.kafka.admin();
    this.producer = this.kafka.producer();

    this.contractTopicConsumer = this.kafka.consumer({
      groupId: KAFKA_TOPIC_CONFIG.contract_consumer_group_id,
    });
  }

  /**
   * connect kafka objects
   * get last message from contract topic and extract information of start block for eosio-ship-reader
   * @returns extracted blocknum and type
   */
  async connect(): Promise<ResetInfo> {
    try {
      logger.info('Initializing Kafka communication');

      await this.producer.connect();
      logger.info('Kafka message producer connected');

      // get current offset (last message) for contract topic
      const topicOffsets = await this.admin.fetchTopicOffsets(KAFKA_TOPIC_CONFIG.contract_topic);
      logger.debug(`Fetching offset for contract topic ${KAFKA_TOPIC_CONFIG.contract_topic}`);

      // if offset for contract topic exists
      if (topicOffsets && topicOffsets.length === 1) {
        // get the current offset and decrease by 1
        const seekEntry: SeekEntry = topicOffsets[0];
        const offset = Number(seekEntry.offset) - 1;
        logger.debug(
          `Offset for consumer of contract topic ${KAFKA_TOPIC_CONFIG.contract_topic} ` +
            `resolved to ${seekEntry.offset}, resetting consumer offset to ${offset}`,
        );

        // reset offset for consumer to get the previous message on next consume
        await this.admin.setOffsets({
          groupId: KAFKA_TOPIC_CONFIG.contract_consumer_group_id,
          topic: KAFKA_TOPIC_CONFIG.contract_topic,
          partitions: [
            { partition: KAFKA_TOPIC_CONFIG.contract_topic_partition, offset: offset.toString() },
          ],
        });
        logger.debug(
          `Consumer offset for contract topic ${KAFKA_TOPIC_CONFIG.contract_topic} successfully reset`,
        );

        // connect to contract topic
        await this.contractTopicConsumer.connect();
        await this.contractTopicConsumer.subscribe({
          topic: KAFKA_TOPIC_CONFIG.contract_topic,
          fromBeginning: true,
        });
        logger.debug(
          `Consumer for contract topic ${KAFKA_TOPIC_CONFIG.contract_topic} connected and subscribed`,
        );

        // consume topic and retrieve last message to get starting blocknum and type
        return new Promise<ResetInfo>(resolve => {
          this.contractTopicConsumer.run({
            eachMessage: async ({ message }) => {
              const messageJSON = JSON.parse(message.value.toString());
              const resetInfo = {
                // either it is a "regular" message or a fork event
                // in case it was a "regular" message, take last blocknum and increase by 1, since the last blocknum was successfully processed
                last_blocknum: Number(messageJSON.blocknum) + 1 || messageJSON.restart_at_block,
                type: messageJSON.reset_type || 'restart',
              };
              logger.info(
                `Received last message from contract topic '${KAFKA_TOPIC_CONFIG.contract_topic}': %o`,
                resetInfo,
              );

              // disconnect consumer since we don't need to listen on events on the contract topic anymore
              this.contractTopicConsumer.stop();
              this.contractTopicConsumer.disconnect();
              logger.debug(
                `Successfully disconnected contract consumer for topic ${KAFKA_TOPIC_CONFIG.contract_topic}`,
              );
              resolve(resetInfo);
            },
          });
        });
      }
    } catch (err) {
      logger.warn(err, 'Error initializing Kafka communication');
      this.gracefulShutdown();
      return { last_blocknum: '-1', type: null };
    }

    // if topic is empty (initial state), return empty object
    return { last_blocknum: null, type: null };
  }

  /**
   * send arbitrary messages to the raw topic
   * @param msg the message to be sent (string)
   * @param action_type the action_type which is added as header
   */
  async sendEvent(msg: string, action_type: string) {
    try {
      logger.debug(
        `Sending new message of type ${action_type} to ${KAFKA_TOPIC_CONFIG.contract_topic}`,
      );
      await this.producer.send({
        topic: KAFKA_TOPIC_CONFIG.contract_topic,
        acks: KAFKA_TOPIC_CONFIG.contract_topic_acks,
        messages: [
          {
            value: await msg,
            headers: {
              ['type']: `${this.config.header_prefix}.${action_type}`,
            },
          },
        ],
      });
    } catch (err) {
      logger.warn(err, `Error sending msg to contract topic ${KAFKA_TOPIC_CONFIG.contract_topic}`);
      await this.gracefulShutdown();
    }
  }

  /**
   * gracefully close Kafka objects
   */
  async gracefulShutdown() {
    try {
      logger.info('Graceful shutdown of Kafka objects initiated');
      this.admin && (await this.admin.disconnect());
      logger.debug('Successfully disconnected Kafka admin');

      this.producer && (await this.producer.disconnect());
      logger.debug('Successfully disconnected Kafka message producer');

      logger.info('Graceful shutdown finished');
      process.exit(0);
    } catch (error) {
      logger.error(`Graceful shutdown failed due to ${error}, exiting process`);
      process.exit(1);
    }
  }
}

export = KafkaWrapper;
