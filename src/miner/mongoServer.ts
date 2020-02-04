import { getLogger } from "log4js"
import { Db, MongoClient } from "mongodb"
import { FC } from "./config"
import { IMinedBlock, INetwork, IPool, IWorker } from "./utils"

const logger = getLogger("MongoServer")

export class MongoServer {
    public db: Db
    private url: string
    private client: MongoClient
    private dbName = FC.MONGO_DB

    constructor() {
        this.url = FC.URL_MONGO_SERVICE
        this.init()
    }
    public async init() {
        this.client = await MongoClient.connect(this.url, { useUnifiedTopology: true })
        this.db = this.client.db(this.dbName)
        logger.info("mongodb initialized...")
    }

    public async resetWorkers() {
        const collection = this.db.collection(FC.MONGO_WORKERS)
        // To delete all documents in a collection, pass an empty document ({})
        await collection.deleteMany({})
    }
    public async findWorker(id: string): Promise<IWorker> {
        const collection = this.db.collection(FC.MONGO_WORKERS)
        const rows = await collection.find({ id }).limit(1).toArray()
        if (rows.length === 1) {
            return rows[0]
        } else {
            return undefined
        }
    }
    public async removeWorker(id: string) {
        const collection = this.db.collection(FC.MONGO_WORKERS)
        await collection.deleteOne({ _id: id })
    }
    public async updateWorker(workerId: string, update: any) {
        const collection = this.db.collection(FC.MONGO_WORKERS)
        await collection.updateOne({ _id: workerId }, { $set: update }, { upsert: true })
    }
    public async getWorkers(): Promise<IWorker[]> {
        const collection = this.db.collection(FC.MONGO_WORKERS)
        const rows = await collection.find().toArray()
        return rows
    }
    public async addMinedBlock(block: IMinedBlock) {
        const collection = this.db.collection(FC.MONGO_MINED_BLOCKS)
        await collection.insertOne(block)
    }
    public async getMinedBlocks() {
        const collection = this.db.collection(FC.MONGO_MINED_BLOCKS)
        const rows = await collection.find().toArray()
        return rows
    }
    public async deleteMinedBlock(blockHash: string) {
        const collection = this.db.collection(FC.MONGO_MINED_BLOCKS)
        await collection.deleteOne({ _id: blockHash })
    }
    public async updateMinedBlock(blockhash: string, status: string) {
        const collection = this.db.collection(FC.MONGO_MINED_BLOCKS)
        await collection.updateOne({ _id: blockhash }, { $set: { status } })
    }
    public async addMinedBlockHistory(block: IMinedBlock) {
        const collection = this.db.collection(FC.MONGO_MINED_BLOCKS_HISTORY)
        await collection.insertOne(block)
    }
    public async getPool(): Promise<IPool> {
        const collection = this.db.collection(FC.MONGO_POOL)
        const rows = await collection.find().toArray()
        if (rows.length === 1) {
            return rows[0]
        } else {
            return undefined
        }
    }
    public async updatePool(summary: IPool) {
        const collection = this.db.collection(FC.MONGO_POOL)
        await collection.deleteMany({})
        await collection.insertOne(summary)
    }
    public async updateNetwork(summary: INetwork) {
        const collection = this.db.collection(FC.MONGO_NETWORK)
        await collection.deleteMany({})
        await collection.insertOne(summary)
    }
    public async getNetwork(): Promise<INetwork> {
        const collection = this.db.collection(FC.MONGO_NETWORK)
        const rows = await collection.find().toArray()
        if (rows.length === 1) {
            return rows[0]
        } else {
            return undefined
        }
    }
}
