import { getLogger } from "log4js"
import { Address } from "../common/address"
import { Block } from "../common/block"
import { BlockHeader } from "../common/blockHeader"
import { TxPool } from "../common/txPool"
import { Consensus } from "../consensus/consensus"
import { DBBlock } from "../consensus/database/dbblock"
import { WorldState } from "../consensus/database/worldState"
import { IUncleCandidate } from "../consensus/uncleManager"
import { userOptions } from "../main"
import { Network } from "../network/network"
import { Hash } from "../util/hash"
import { Banker } from "./banker"
import { FC } from "./config"
import { MongoServer } from "./mongoServer"
import { RabbitmqServer } from "./rabbitServer"
import { IMinedBlock, IPool, IWorker, sma } from "./utils"

const logger = getLogger("Miner")

export class MinerServer {
    public txpool: TxPool
    public consensus: Consensus
    public mongoServer: MongoServer
    public queuePutWork: RabbitmqServer
    public queueSubmitWork: RabbitmqServer
    public network: Network
    private intervalId: NodeJS.Timer
    private worldState: WorldState
    private banker: Banker
    private blockGap: number
    private networkHashRate: number

    public constructor(txpool: TxPool, worldState: WorldState, consensus: Consensus, network: Network) {
        this.txpool = txpool
        this.worldState = worldState
        this.consensus = consensus
        this.network = network
        this.mongoServer = new MongoServer()
        this.blockGap = 0
        this.networkHashRate = 0
        // received a new block, starting to min based on the block
        this.consensus.on("candidate",
            (previousDBBlock: DBBlock, previousHash: Hash, difficulty: number, minerReward: number, uncleCandidates?: IUncleCandidate[]) =>
                this.candidate(previousDBBlock, previousHash, difficulty, minerReward, uncleCandidates),
        )
        this.setupRabbitMQ()
        this.setupBanker()
    }

    private setupBanker() {
        this.banker = new Banker(this)
        this.banker.bankerPooling()
    }

    private async setupRabbitMQ() {
        this.queuePutWork = new RabbitmqServer("putwork")
        await this.queuePutWork.initialize()
        this.queueSubmitWork = new RabbitmqServer("submitwork")
        await this.queueSubmitWork.initialize()
        this.queueSubmitWork.receive((msg: any) => {
            logger.info(" [x] Received SubmitBlock %s", msg.content.toString())
            const one = JSON.parse(msg.content.toString())
            const block = Block.decode(Buffer.from(one.block)) as Block
            const minerReward = one.minerReward
            this.updateStat(block, minerReward)
            this.submitBlock(block)
        })
    }

    private async submitBlock(block: Block) {
        this.network.broadcastBlocks([block])
        await this.consensus.putBlock(block)
    }

    private async updateStat(block: Block, minerReward: number) {
        let hashrate
        if (this.blockGap === 0) {
            hashrate = 0
        } else {
            hashrate = this.networkHashRate / this.blockGap
        }
        const tick = Date.now()
        const pool = await this.mongoServer.getPool()
        const hashratePriv = pool === undefined ? 0 : pool.hashrate
        const hashrateSMA = sma(hashrate, hashratePriv, 20)
        this.mongoServer.updatePool({ hashrate: hashrateSMA, tick })
        const workers: IWorker[] = await this.mongoServer.getWorkers()
        const addresses = new Array<string>()
        const shares = new Array<number>()
        let totalShares = 0
        for (const worker of workers) {
            totalShares += worker.shares
            const index = addresses.indexOf(worker.address)
            if (index === -1) {
                addresses.push(worker.address)
                shares.push(worker.shares)
            } else {
                shares[index] += worker.shares
            }
        }
        for (const worker of workers) {
            worker.hashrate = hashrateSMA * (worker.shares / totalShares)
            this.mongoServer.updateWorker(worker._id, { hashrate: worker.hashrate, shares: 0 })
        }
        const hash = new Hash(block)
        const minedBlock: IMinedBlock = {
            _id: hash.toString(),
            addresses,
            paied: false,
            prevHash: block.header.previousHash[0].toString(),
            reward: minerReward,
            shares,
            status: "TBC",
            timestamp: Date.now(),
            totalShares,
        }
        this.mongoServer.addMinedBlock(minedBlock)
        this.blockGap = 0
    }

    private async updateNetworkInfo(difficulty: number, minerReward: number) {
        this.blockGap++
        this.networkHashRate = 1 / difficulty / (15 / Math.LN2)
        const poolDiff = difficulty * FC.POOL_SOLUTION_SPACE > 1 ? 1 : difficulty * FC.POOL_SOLUTION_SPACE
        const network = {
            blockGap: this.blockGap,
            fee: FC.POOL_FEE,
            hashrate: this.networkHashRate,
            poolDiff,
            reward: minerReward,
            tick: Date.now(),
        }
        this.mongoServer.updateNetwork(network)
    }

    private candidate(previousDBBlock: DBBlock, previousHash: Hash, difficulty: number, minerReward: number, uncleCandidates: IUncleCandidate[] = []): void {
        if (!userOptions.bootstrap && ((Date.now() - previousDBBlock.header.timeStamp) > 86400000)) {
            logger.error("Last block is more than a day old, waiting for synchronization prior to mining.")
            return
        }
        logger.info(`Received an new block ${previousHash.toString()} with height ${previousDBBlock.height}, starting to min based on the block`)
        this.updateNetworkInfo(difficulty, minerReward)
        const miner: Address = new Address(FC.MINER_ADDRESS)
        clearInterval(this.intervalId)
        const previousHashes = [previousHash]
        for (const uncle of uncleCandidates) {
            previousHashes.push(uncle.hash)
        }
        if (previousHashes.length > 1) {
            logger.debug(`Mining next block with ${previousHashes.length - 1} uncle(s)`)
        }
        this.createCandidate(previousDBBlock, difficulty, previousHashes, miner, minerReward, uncleCandidates)
        // A same block but different timestamp candidate job has been push to real miner periodically to empirical increase mining randomness
        this.intervalId = setInterval(() => this.createCandidate(previousDBBlock, difficulty, previousHashes, miner, minerReward, uncleCandidates), 1000 * 10)
    }

    private async createCandidate(previousDBBlock: DBBlock, difficulty: number, previousHash: Hash[], miner: Address, minerReward: number, uncleCandidates?: IUncleCandidate[]) {
        const height = previousDBBlock.height + 1
        const timeStamp = Math.max(Date.now(), previousDBBlock.header.timeStamp + 50)
        const { stateTransition: { currentStateRoot }, validTxs, invalidTxs } = await this.worldState.next(previousDBBlock.header.stateRoot, miner, minerReward, undefined, height, uncleCandidates)
        this.txpool.removeTxs(invalidTxs)
        const block = new Block({
            header: new BlockHeader({
                difficulty,
                merkleRoot: Block.calculateMerkleRoot(validTxs),
                miner,
                nonce: -1,
                previousHash,
                stateRoot: currentStateRoot,
                timeStamp,
            }),
            txs: validTxs,
        })
        const prehash = block.header.preHash()
        const putWorkData = { block: block.encode(), prehash: Buffer.from(prehash), minerReward }
        this.queuePutWork.send(JSON.stringify(putWorkData))

    }
}
