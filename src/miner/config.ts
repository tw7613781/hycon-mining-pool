export const FC = {
    // Pool Config
    CONNECTION_LIMIT: 70,
    MINER_ADDRESS: "H2qWgArv74rQFDTS8nSd3WJ82wmQRH5oP",
    NUM_TXS_CONFIRMATIONS: 200,
    POOL_SOLUTION_SPACE: 200,
    TEST_BLOCK_DIFF: Number("1e-5"),

    // MongoDB
    MONGO_DB: "MiningPool",
    MONGO_MINED_BLOCKS: "MinedBlocks",
    MONGO_MINED_BLOCKS_HISTORY: "MinedBlocksHistory",
    MONGO_NETWORK: "Network",
    MONGO_POOL: "Pool",
    MONGO_WORKERS: "Workers",
    URL_MONGO_SERVICE: "mongodb://127.0.0.1:27017",

    // Bannker
    BANKER_POOLING_INTERVAL: 1000 * 60 * 2,
    BANKER_WALLET_MNEMONIC: "",
    BANKER_WALLET_PASSPHRASE: "",
    MINER_FEE: 0.000000001,
    POOL_FEE: 0.005,

    // RabbitMQ
    URL_RABBITMQ_SERVICE: "amqp://localhost",

    // StratumServer
    STRATUMSERVER_PORT: 9081,

    // UncleInfo
    API_URL: "https://api.hycon.io/api/v2/uncle/",

}
