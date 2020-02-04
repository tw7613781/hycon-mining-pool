import { randomBytes } from "crypto"
import { getLogger } from "log4js"
import { Address } from "../common/address"
import { Block } from "../common/block"
import { JabiruConsensus } from "../consensus/consensusJabiru"
import { DifficultyAdjuster } from "../consensus/difficultyAdjuster"
import { Hash } from "../util/hash"
import { FC } from "./config"
import { MongoServer } from "./mongoServer"
import { RabbitmqServer } from "./rabbitServer"
import { getRandomIndex, hexToLongLE, IJob, IWorker, testBlock } from "./utils"

// tslint:disable-next-line:no-var-requires
const LibStratum = require("stratum").Server
const logger = getLogger("Stratum")

export class StratumServer {

    private toobusy: number
    private stratum: any
    private port: number
    private jobId: number
    private clientId: number
    private maxJob: number
    private stratumId: string
    private mongoServer: MongoServer
    private queuePutWork: RabbitmqServer
    private queueSubmitWork: RabbitmqServer
    private mapWorker: Map<string, IWorker>
    private mapJob: Map<number, IJob>
    private poolDiff: number
    private testServer: boolean

    constructor(mongoServer: MongoServer, test: boolean = false) {
        this.mongoServer = mongoServer
        this.testServer = test
        this.port = FC.STRATUMSERVER_PORT
        this.toobusy = FC.CONNECTION_LIMIT
        this.mapWorker = new Map<string, IWorker>()
        this.jobId = 0
        this.clientId = 0
        this.maxJob = 10
        this.mapJob = new Map<number, IJob>()
        this.stratumId = randomBytes(10).toString("hex")
        this.stratum = new LibStratum({ settings: { port: this.port, toobusy: this.toobusy } })
        if (this.testServer) {
            setInterval(() => {
                const difficulty = getRandomIndex(9) * FC.TEST_BLOCK_DIFF
                const hashrate = 1 / (difficulty * JabiruConsensus.TARGET_MEAN_TIME * 0.001)
                logger.debug(`Testing a block with difficulty: ${difficulty.toExponential()} <> ${hashrate.toFixed(2)} H/s`)
                const block = testBlock(difficulty)
                const prehash = block.header.preHash()
                const minerReward = 12e9
                this.putWork(block, prehash, minerReward)
            }, 1000 * 10)
        } else {
            this.setupRabbitMQ()
        }
        setImmediate(() => {
            this.init()
        })
    }

    private async setupRabbitMQ() {
        this.queuePutWork = new RabbitmqServer("putwork")
        await this.queuePutWork.initialize()
        this.queueSubmitWork = new RabbitmqServer("submitwork")
        await this.queueSubmitWork.initialize()
        this.queuePutWork.receive((msg: any) => {
            logger.info(" [x] Received PutWork %s", msg.content.toString())
            const one = JSON.parse(msg.content.toString())
            const block = Block.decode(Buffer.from(one.block)) as Block
            const prehash = Buffer.from(one.prehash)
            const minerReward = one.minerReward
            this.putWork(block, prehash, minerReward)
        })
        this.queueSubmitWork.receive(async (msg: any) => {
            logger.info(" [x] Received SubmitBlock %s", msg.content.toString())
            this.reset()
        })
    }

    private reset() {
        for (const [jobId, job] of this.mapJob) {
            job.solved = true
            this.mapJob.set(jobId, job)
        }
        for (const [workerId, worker] of this.mapWorker) {
            worker.shares = 0
            this.mapWorker.set(workerId, worker)
        }
    }

    private putWork(block: Block, prehash: Uint8Array, minerReward: number) {
        try {
            // generate job with pool standard difficulty as a mining share
            this.poolDiff = block.header.difficulty * FC.POOL_SOLUTION_SPACE > 1 ? 1 : block.header.difficulty * FC.POOL_SOLUTION_SPACE
            const target = JabiruConsensus.getTarget(this.poolDiff)
            const job = this.newJob(block, target, prehash, minerReward)
            let index = getRandomIndex(0x7FFFF)
            this.mapWorker.forEach((worker) => {
                if (worker.socket !== undefined) {
                    this.notifyJob(worker.socket, index, job, worker.name)
                    index++
                }
            })
        } catch (e) {
            logger.error(`putWork ${e}`)
        }
    }

    private newJob(block: Block, target: Buffer, prehash: Uint8Array, minerReward: number): IJob {
        this.jobId++
        if (this.jobId > 0x7FFFFFFF) { this.jobId = 0 }
        this.mapJob.delete(this.jobId - this.maxJob)
        const prehashHex = Buffer.from(prehash as Buffer).toString("hex")
        const targetHex = target.slice(target.length - 8).toString("hex")
        const job = {
            block,
            id: this.jobId,
            minerReward,
            prehash,
            prehashHex,
            solved: false,
            target,
            targetHex,
        }
        this.mapJob.set(this.jobId, job)
        logger.debug(`Created new job(${this.jobId})`)
        return job
    }

    private notifyJob(socket: any, index: number, job: IJob, name: string) {
        if (socket === undefined) {
            logger.warn("Undefined stratum socket")
            return
        }

        socket.notify([
            index,      // job_prefix
            job.prehashHex,
            job.targetHex,
            job.id,
            "0", // empty
            "0", // empty
            "0", // empty
            "0", // empty
            true, // empty
        ]).then(
            () => {
                logger.debug(`Put job(${job.id}) - ${name} miner success `)
            },
            () => {
                logger.debug(`Put work - ${name} miner fail `)
            },
        )
    }

    private async init() {
        logger.fatal(`Mining Pool pool.hycon.io is running up`)
        // deferred.resolve() or deferred.reject() will pass to socket
        this.stratum.on("mining", async (req: any, deferred: any, socket: any) => {
            switch (req.method) {
                case "subscribe":
                    deferred.resolve([socket.id, "0", "0", 4])
                    break
                case "authorize":
                    const [address] = req.params.slice(0, 1)
                    const remoteIP = socket.socket.remoteAddress
                    this.clientId++
                    if (this.clientId > 0x7FFFFFFF) { this.clientId = 0 }
                    const stratumName = this.stratumId + "_" + this.clientId.toString()
                    if (Address.isAddress(address)) {
                        const worker = {
                            _id: socket.id,
                            address,
                            hashrate: 0,
                            ip: remoteIP,
                            name: stratumName,
                            shares: 0,
                            socket,
                            tick: Date.now(),
                        }
                        this.mapWorker.set(socket.id, worker)
                        const temp = Object.assign({}, worker)
                        delete temp.socket
                        this.mongoServer.updateWorker(worker._id, temp)
                        logger.info(`An new worker join: ${worker.name} ## ${address} ## ${remoteIP}`)
                    } else {
                        logger.error(`An new worker join: Hycon address ${address} is invalid, please connect with a valid Hycon address`)
                        deferred.resolve([false])
                        break
                    }
                    const job = this.mapJob.get(this.jobId)
                    if (job !== undefined) {
                        this.notifyJob(socket, getRandomIndex(0x7FFFF), job, stratumName)
                    }
                    deferred.resolve([true])
                    break
                case "submit":
                    logger.debug(`Submit job id : ${req.params.job_id} / nonce : ${req.params.nonce} / result : ${req.params.result}`)
                    const jobId: number = Number(req.params.job_id)
                    let result = false
                    result = await this.completeWork(jobId, req.params.nonce, socket.id)
                    deferred.resolve([result])
                    break
                default:
                    deferred.reject(LibStratum.errors.METHOD_NOT_FOUND)
            }
        })

        this.stratum.on("mining.error", (error: any, socket: any) => {
            logger.error("Mining error: ", error)
        })

        this.stratum.listen().done((msg: any) => {
            logger.info(msg)
        })

        this.stratum.on("close", (socketId: any) => {
            this.mapWorker.delete(socketId)
            this.mongoServer.removeWorker(socketId)
            logger.info(`Miner socket(${socketId}) closed `)
        })
    }

    private async completeWork(jobId: number, nonceStr: string, workerId: string): Promise<boolean> {
        try {
            if (nonceStr.length !== 16) {
                logger.warn(`Invalid Nonce (NONCE : ${nonceStr})`)
                return false
            }
            const job = this.mapJob.get(jobId)
            if (job === undefined) {
                logger.warn(`Miner submitted unknown/old job ${jobId})`)
                return false
            }
            const worker = this.mapWorker.get(workerId)
            if (worker === undefined) {
                logger.warn(`Submmited from an invalid worker ${workerId}`)
                return false
            }
            const nonce = hexToLongLE(nonceStr)
            const buffer = Buffer.allocUnsafe(72)
            buffer.fill(job.prehash, 0, 64)
            buffer.writeUInt32LE(nonce.getLowBitsUnsigned(), 64)
            buffer.writeUInt32LE(nonce.getHighBitsUnsigned(), 68)
            const cryptonightHash = await Hash.hashCryptonight(buffer)
            logger.debug(`nonce: ${nonceStr}, targetHex: ${job.targetHex}, target: ${job.target.toString("hex")}, hash: ${Buffer.from(cryptonightHash).toString("hex")}`)
            if (job.solved) {
                logger.debug(`Job(${job.id}) already solved`)
                return true
            }
            if (!DifficultyAdjuster.acceptable(cryptonightHash, job.target)) {
                logger.warn(`Received a invalid share from ${worker.name}`)
                return false
            }
            logger.debug(`Received a valid share from ${worker.name}`)
            this.updateWorker(worker)
            // real block difficulty
            const target = JabiruConsensus.getTarget(job.block.header.difficulty)
            if (!DifficultyAdjuster.acceptable(cryptonightHash, target)) {
                logger.debug(`The share is not good enough to be a valid block`)
                return true
            }
            job.solved = true
            this.mapJob.set(job.id, job)
            const minedBlock = new Block(job.block)
            minedBlock.header.nonce = nonce
            const submitData = { block: minedBlock.encode(), minerReward: job.minerReward }
            this.queueSubmitWork.send(JSON.stringify(submitData))
            const blockHash = new Hash(minedBlock)
            logger.info(`Found a block ${blockHash.toString()}`)
            return true
        } catch (e) {
            throw new Error(`Fail to submit nonce : ${e}`)
        }
    }

    private async updateWorker(worker: IWorker) {
        worker.shares++
        this.mapWorker.set(worker._id, worker)
        this.mongoServer.updateWorker(worker._id, { shares: worker.shares })
    }
}

async function main() {
    const mongodb = new MongoServer()
    const server = new StratumServer(mongodb, false)
}

main().catch((e: any) => {
    logger.error(e)
})
