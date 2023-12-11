import {
  EosioReaderAction,
  EosioReaderActionFilter,
  EosioReaderTableRowFilter,
} from '@blockmatic/eosio-ship-reader';
import { getLogger } from '../src/common/config';
import { ActionData, ActionHandlerResult } from '../src/common/types';
import ShipReaderWrapper from '../src/eosio/ship-reader-wrapper';

const logger = getLogger('atomicmarket_example');

/**
 * define tables and actions to listen for
 */
const table_rows_whitelist: () => EosioReaderTableRowFilter[] = () => [
  { code: 'atomicmarket', table: 'auctions' },
  { code: 'atomicmarket', table: 'balances' },
  { code: 'atomicmarket', table: 'buyoffers' },
  { code: 'atomicmarket', table: 'config' },
  { code: 'atomicmarket', table: 'counters' },
  { code: 'atomicmarket', table: 'marketplaces' },
  { code: 'atomicmarket', table: 'sales' },
];

const actions_whitelist: () => EosioReaderActionFilter[] = () => [
  { code: 'atomicmarket', action: '*' },
];

/**
 * define the handler which reacts on actions contained in a block
 * the message returned by this method will be sent to contract topic
 * @param actionData
 * @returns
 */
const handleAction = (actionData: ActionData): ActionHandlerResult => {
  const action: EosioReaderAction = actionData.eosio_reader_action;

  switch (action.name) {
    default:
      logger.debug(`Ignoring action ${action.name}`);
      break;
    case 'lognewsale':
      if ('atomicmarket' === action.receipt.receiver) {
        return {
          msg: JSON.stringify({
            blocknum: actionData.blocknum,
            timestamp: actionData.timestamp,
            type: action.name,
            transaction_id: action.transaction_id,
            data: action.data,
          }),
          action_type: actionData.eosio_reader_action.name,
        };
      }
  }
};

/**
 * configure and start event-processor-node
 */
const run = async () => {
  const wrapper: ShipReaderWrapper = new ShipReaderWrapper({
    actions_whitelist: actions_whitelist,
    message_header_prefix: 'atomicmarket',
    table_rows_whitelist: table_rows_whitelist,
    action_handler: handleAction,
  });
  wrapper.startProcessing();
};

run();
