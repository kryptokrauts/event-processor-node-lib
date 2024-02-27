import {
  createEosioShipReader,
  EosioReaderAbisMap,
  EosioReaderBlock,
  EosioReaderConfig,
} from '@blockmatic/eosio-ship-reader';
import { takeWhile } from 'rxjs/operators';
import { EOSIO_CONFIG, getLogger, KAFKA_CONFIG, KAFKA_TOPIC_CONFIG } from '../common/config';
import {
  ActionHandlerResult,
  delta_whitelist,
  ResetEvent,
  ShipReaderWrapperConfig,
} from '../common/types';
import KafkaWrapper from '../kafka/kafka-wrapper';
import { fetchAbi, getHeadBlockNum } from './chain-api';

const logger = getLogger('ship-reader-wrapper');
const signal_traps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
const error_types = ['unhandledRejection', 'uncaughtException'];

//current finality is 3 minutes, with a new block every 0.5s -> 360 blocks
const num_blocks_to_finality = 3 * 60 * 2;

export class ShipReaderWrapper {
  config: ShipReaderWrapperConfig = undefined;
  forked: boolean = false;
  subscriptions = [];
  start_block: number = undefined;
  current_block: number = undefined;
  last_irreversible_block: number = undefined;
  kafka_wrapper: KafkaWrapper = undefined;
  reader_in_sync: boolean = false;

  constructor(config: ShipReaderWrapperConfig) {
    this.config = config;

    // handle controlled os signals
    signal_traps.forEach(type => {
      this.handleEvent(type);
    });

    // handle unexpected error
    error_types.forEach(type => {
      this.handleEvent(type);
    });
  }

  /**
   * Start processing (event-processor-node)
   *
   * - start listening on XPR Network node based on
   * 	- blocknum of last processed message or
   * 	- env variable
   * - filtering incoming events
   * - providing them as Kafka message to subsequent processing
   */
  async startProcessing() {
    // manual override for testing
    logger.info('--- ship-reader-wrapper configuration ---');
    logger.info(EOSIO_CONFIG);
    logger.info(KAFKA_CONFIG);
    logger.info(KAFKA_TOPIC_CONFIG);

    // connect to kafka and retrieve last processed message data

    this.kafka_wrapper = new KafkaWrapper({ header_prefix: this.config.message_header_prefix });

    const { last_blocknum: last_blocknum, type } = await this.kafka_wrapper.connect();

    if (last_blocknum) {
      this.start_block = Number(last_blocknum) + 1;
      logger.info(
        `Resume listening on chain events at blocknum ${this.start_block} based on last processed message in ` +
          `contract topic ${KAFKA_TOPIC_CONFIG.contract_topic}. Cause: ${type} event`,
      );
    } else if (!last_blocknum) {
      this.start_block = EOSIO_CONFIG.start_block;
      logger.info(
        `Initially start listening on chain events based on env variable 'EOSIO_START_BLOCK' ${this.start_block}`,
      );
    }

    if (this.start_block !== -1) {
      this.current_block = this.start_block;
      this.checkReaderSyncState(this.start_block);

      // start listening to XPR Network node
      this.startShipReader();
    }
  }

  /**
   * handling of fork event
   * - stop eosio-ship-reader by setting fork flag
   * - create fork message ResetEvent
   * - push ResetEvent to contract topic for further processing
   * - shutdown the event-processor-node to be restarted at the last irreversible block
   * @param message incoming for message
   */
  private async handleFork(forkBlock: number) {
    try {
      // set fork flag to stop block subscriptions
      this.forked = true;

      logger.warn(
        `Received fork event ${forkBlock}, preparing for reset at block ${this.last_irreversible_block}`,
      );
      const resetEvent: string = this.createResetEvent(
        'fork',
        `fork occurred at block ${forkBlock}`,
        this.last_irreversible_block,
        true,
      );

      logger.warn(
        `Emitting new ResetEvent to contract topic ${KAFKA_TOPIC_CONFIG.contract_topic}: %o`,
        resetEvent,
      );

      await this.kafka_wrapper.sendEvent(resetEvent, 'reset_event');

      logger.warn('Fork message successfully handled, restarting');
    } catch (err) {
      logger.error(err, 'Error handling fork, restarting');
    } finally {
      this.gracefulShutdown();
    }
  }

  /**
   * Start listening on XPR Network node
   *
   * - subscribe to blocks observable for data processing
   * - subscribe to forks observable for microfork handling
   * - subscribe to close observable to react on websocket close event
   */
  private async startShipReader() {
    const { close$, blocks$, forks$ } = await this.getShipReader();

    // subscribe to microfork events
    this.subscriptions.push(
      forks$.subscribe(async fork => {
        this.handleFork(fork);
      }),
    );

    // subscribe to incoming blocks event
    this.subscriptions.push(
      blocks$.pipe<EosioReaderBlock>(takeWhile(() => !this.forked)).subscribe(async block => {
        logger.trace(`Current block ${this.current_block}`);

        let syncStateCheckInterval: number = 10 * num_blocks_to_finality;
        if (logger.isLevelEnabled('trace')) {
          syncStateCheckInterval = num_blocks_to_finality;
        }

        // since replaying blocks is much faster, check within greater block-span
        if (!this.reader_in_sync && block.block_num % syncStateCheckInterval === 0) {
          this.checkReaderSyncState(block.block_num);
        }

        if (block.actions?.length > 0) {
          for (const action of block.actions) {
            // only handle if block contains action data
            if (action && action.data) {
              try {
                const result: ActionHandlerResult = this.config.action_handler({
                  eosio_reader_action: action,
                  blocknum: block.block_num,
                });

                // if a processing error occurs - throw and kill process
                if (result && result.error) {
                  throw result.error;
                }
                // otherwise check if the result contains a msg, msg undefined means ingore
                if (result && result.msg) {
                  const msg = JSON.stringify({
                    blocknum: block.block_num,
                    timestamp: new Date(block.timestamp).getTime(),
                    type: action.name,
                    transaction_id: action.transaction_id,
                    data: result.msg,
                    global_sequence: action.global_sequence,
                  });
                  await this.kafka_wrapper.sendEvent(msg, action.name);
                } else {
                  logger.trace(`Ignoring empty action block`);
                }
              } catch (err) {
                logger.error(err, `Error occurred handling message of type ${action.name}`);
                this.sendEventAndEndProcess(`handle_message_${action.name}`, err);
              }
            }
          }
        }
        this.current_block = block.block_num;
        this.last_irreversible_block = block.last_irreversible_block_num;
      }),
    );

    // subscribe to websocket connection close events
    this.subscriptions.push(
      close$.subscribe(() => {
        logger.error('Websocket connection was closed, exiting process');
        this.gracefulShutdown();
      }),
    );
  }

  private async checkReaderSyncState(current_block: number): Promise<void> {
    const head_block = Number(await getHeadBlockNum());
    const head_diff = head_block - current_block;
    this.reader_in_sync = head_diff - num_blocks_to_finality <= 0;

    if (this.reader_in_sync) {
      logger.info('Reader is in sync with current block height');
    } else {
      logger.info(`Reader is at block height ${current_block}, diff to head is ${head_diff}`);
    }
  }

  /**
   * Configure and create eosio ship reader
   *
   * @returns
   */
  private async getShipReader() {
    const uniqueContractNames = [
      ...new Set(this.config.table_rows_whitelist().map(row => row.code)),
    ];
    const abisArr = await Promise.all(
      uniqueContractNames.map(account_name => fetchAbi(account_name)),
    );

    const contract_abis: () => EosioReaderAbisMap = () => {
      const numap = new Map();
      abisArr.forEach(({ account_name, abi }) => numap.set(account_name, abi));
      return numap;
    };

    const eosioReaderConfig: EosioReaderConfig = {
      ws_url: EOSIO_CONFIG.eosio_ship_api,
      rpc_url: EOSIO_CONFIG.eosio_node_api,
      ds_threads: 6,
      ds_experimental: false,
      delta_whitelist: delta_whitelist,
      table_rows_whitelist: this.config.table_rows_whitelist,
      actions_whitelist: this.config.actions_whitelist,
      contract_abis,
      request: {
        start_block_num: this.start_block,
        end_block_num: 0xffffffff,
        max_messages_in_flight: 50,
        have_positions: [],
        irreversible_only: false,
        fetch_block: true,
        fetch_traces: true,
        fetch_deltas: true,
      },
      auto_start: true,
    };

    return await createEosioShipReader(eosioReaderConfig);
  }

  /**
   * gracefully shutdown observables and Kafka objects
   */
  private async gracefulShutdown() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    await this.kafka_wrapper.gracefulShutdown();
  }

  /**
   * Create a defined reset event and transform to string
   * @param reset_type
   * @param restart_at_block
   * @param clean_database
   * @returns
   */
  private createResetEvent(
    reset_type: string,
    details: string,
    restart_at_block: number,
    clean_database: boolean,
  ): string {
    if (restart_at_block) {
      const resetEvent: ResetEvent = {
        reset_type,
        timestamp: Date.now().toString(),
        details,
        clean_database,
        reset_blocknum: this.current_block,
        restart_at_block,
      };
      return JSON.stringify(resetEvent);
    }
    return undefined;
  }

  /**
   * Dedicated shutdown procedure
   *
   * - sendEvent with current block, since there is noguarantee that the last processed message contained an action
   * - gracefully shutdown
   *
   * @param type of event, either os signal or unexpected error
   */
  private handleEvent(type: string) {
    process.once(type, async () => {
      await this.sendEventAndEndProcess(type, undefined);
    });
  }

  /**
   * send the shutdown message to Kafka and kill the process
   * @param type type of interruption event
   * @param err error in for additional details
   */
  private async sendEventAndEndProcess(type: string, err: unknown) {
    try {
      logger.warn(`Catched event ${type} with err ${err}, creating reset event for restart`);
      const resetEvent: string = this.createResetEvent(
        'interrupted',
        `caused by ${type}${err ? ': ' + err : ''}`,
        this.current_block,
        false,
      );
      resetEvent && (await this.kafka_wrapper.sendEvent(resetEvent, 'reset_event'));
      await this.gracefulShutdown();
    } finally {
      process.kill(process.pid, type);
    }
  }
}
