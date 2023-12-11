FROM node:21.1.0-alpine3.18 as builder

WORKDIR /node-event-processor
COPY package.json ./
COPY tsconfig.json ./
COPY src ./src
COPY examples ./examples
RUN yarn install --frozen-lockfile
RUN yarn build

FROM node:21.1.0-alpine3.18 as runner

ENV NODE_ENV production

RUN adduser --disabled-password node_user && \
	mkdir -p /node-event-processor && \
	chown -R node_user:node_user /node-event-processor

WORKDIR /node-event-processor

USER node_user

COPY package.json ./
RUN yarn install --frozen-lockfile
COPY --from=builder ./node-event-processor/dist .

ENTRYPOINT ["node", "./examples/atomicmarket.js", " | npx pino-pretty --colorize"]