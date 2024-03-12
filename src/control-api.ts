import express from 'express';
import { control_api_port, getLogger } from './common/config';

const api = express();
const logger = getLogger('reset-api');

export async function startControlApi(reset_handler, instance) {
  api.get('/reset', (request, response) => {
    const restart_at_block = request.query.blocknum;
    const reset_database = request.query.reset_db || false;

    if (restart_at_block === undefined) {
      response.status(404).send('no blocknum defined, aborting');
    } else {
      logger.info(
        `Parameters provided: blocknum: ${restart_at_block}, reset_db: ${reset_database}`,
      );
      reset_handler.call(instance, restart_at_block, reset_database);
      response
        .status(200)
        .send(
          `event to restart at block ${restart_at_block} and reset database = ${reset_database} emitted`,
        );
    }
  });

  api.listen(control_api_port, (): void => {
    logger.info(`processor-node control api started, running on port ${control_api_port}`);
  });
}
