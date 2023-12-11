# event-processor-node library

#### This library provides the following capabilities

- establish communication to Kafka broker network
  - read last message of defined output topic to get last successfully processed blocknum
  - if topic is empty (initial), use env variable
- connect and listen to XPR Network based on [blockmatic/antelope-ship-reader](https://github.com/blockmatic/antelope-ship-reader)
  - start reading at resolved blocknum above
  - listening on user defined contract actions as well as forks
	- provide a `handleAction `callback to implement message transformation
	- transformed messages are automatically sent to the configured Kafka topic with a dedicated header `<message_prefix_header>.<action_name>`

In case of expected shutdown, a SIGTERM/SIGINT listener generates a dedicated `RestInfo` message on the output topic with the last processed blocknum from the ship reader. This allows a reset at this point in case no relevant block data was written to the output topic and thus omits the necessity of reading irrelevant / empty blocks again on restart (in case of bigger gaps).

Using this mechanism also allows a manual reset to a certain blocknum by manually creating such a `ResetInfo` message within the output topic.

In case of forks, the ship reader stops and creates a `ResetInfo` with the last irreversible block as starting point. All subsequent processes can also react on this message.

#### Configuration
Refer to [.env_template](.env_template).

#### Sample usage
The example implementation [atomicmarket.ts](/examples/atomicmarket.ts) show how the necessary configuration is provided
- `table_rows_whitelist` events on contract and contract tables
- `actions_whitelist` contract actions 
The `handleAction` callback is called, whenever one of the whitelisted actions occur
The wrapper is configured and started as follows 
```
const wrapper: ShipReaderWrapper = new ShipReaderWrapper({
	actions_whitelist: actions_whitelist,
	message_header_prefix: 'atomicmarket',
	table_rows_whitelist: table_rows_whitelist,
	action_handler: handleAction,
});
wrapper.startProcessing();
```
The [Dockerfile](Dockerfile) contains the build library and entrypoint for the example.