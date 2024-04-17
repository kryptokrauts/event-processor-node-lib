import {
  EosioReaderAction,
  EosioReaderActionFilter,
  EosioReaderTableRowFilter,
  ShipTableDeltaName,
} from '@blockmatic/eosio-ship-reader';

export interface KafkaWrapperConfig {
  header_prefix: string;
}

export interface ResetInfo {
  last_blocknum: string;
  type: string;
}

export interface ResetEvent {
  // type of event, can be fork or manual reset
  reset_type: string;
  // more details to the reset_type
  details: string;
  // timestamp, reset event occurred
  timestamp: string;
  // the block to restart from on the next run
  restart_at_block: number;
  // blocknum the reset event occured
  reset_blocknum: number;
  // flag for cleaning the internal database, all data after this block will be cleansed
  clean_database: boolean;
}

export interface NodeSyncStatusEvent {
  timestamp: number;
  head_block: number;
  current_block: number;
  diff: number;
  in_sync: boolean;
  current_sync_date: string;
}

export interface ShipReaderWrapperConfig {
  action_handler: (data: ActionData) => ActionHandlerResult;
  message_header_prefix: string;
  table_rows_whitelist: () => EosioReaderTableRowFilter[];
  actions_whitelist: () => EosioReaderActionFilter[];
  emit_current_blocknum: boolean;
}

export interface ActionData {
  eosio_reader_action: EosioReaderAction;
  blocknum: number;
}

export interface ActionHandlerResult {
  msg: unknown;
  error: Error | undefined;
}

export const delta_whitelist: () => ShipTableDeltaName[] = () => [
  'account_metadata',
  'contract_table',
  'contract_row',
  'contract_index64',
  'resource_usage',
  'resource_limits_state',
];
