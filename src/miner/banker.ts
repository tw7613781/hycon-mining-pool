import { hyconfromString } from "@glosfer/hyconjs-util"
import { getLogger } from "log4js"
import { Address } from "../common/address"
import { SignedTx } from "../common/txSigned"
import { BlockStatus } from "../consensus/sync"
import { uncleReward } from "../consensus/uncleManager"
import { Hash } from "../util/hash"
import { Wallet } from "../wallet/wallet"
import { FC } from "./config"
import { MinerServer } from "./minerServer"
import { IMinedBlock, IUncleInfo } from "./utils"

// tslint:disable-next-line: no-var-requires
const request = require("request")
const logger = getLogger("Banker")
export class Banker {
    private wallet: Wallet
    private minerServer: MinerServer

    constructor(minerServer: MinerServer) {
        this.minerServer = minerServer
        this.wallet = Wallet.generate({
            language: "english",
            mnemonic: FC.BANKER_WALLET_MNEMONIC,
            name: "hyconPool",
            passphrase: FC.BANKER_WALLET_PASSPHRASE,
        })
    }

    public bankerPooling() {
        setInterval(() => {
            this.paySalary()
        }, FC.BANKER_POOLING_INTERVAL)
    }

    private async paySalary() {
        const blocks: IMinedBlock[] = await this.minerServer.mongoServer.getMinedBlocks()
        if (blocks.length > 0) {
            for (const block of blocks) {
                const hash = Hash.decode(block._id)
                const blockStatus = await this.minerServer.consensus.getBlockStatus(hash)
                const isMainBlock = blockStatus === BlockStatus.MainChain
                const isUncle = await this.minerServer.consensus.isUncleBlock(hash)
                let status = "TBC"
                let rewardUncle
                if (isMainBlock) {
                    status = "MainBlock"
                } else {
                    if (isUncle) {
                        status = "UncleBlock"
                        const uncleInfo = await this.getUncleInfo(block._id)
                        const depth = uncleInfo === undefined ? 2 : uncleInfo.depth
                        rewardUncle = uncleReward(block.reward, depth)
                    }
                }
                const height = await this.minerServer.consensus.getBlockHeight(hash)
                const tip = this.minerServer.consensus.getBlocksTip()
                if (height + FC.NUM_TXS_CONFIRMATIONS < tip.height) {
                    if (isMainBlock) {
                        this.distributeIncome(block, block.reward)
                        block.status = status
                        block.paied = true
                        this.moveToHistory(block)
                    } else if (isUncle) {
                        this.distributeIncome(block, rewardUncle.toNumber())
                        block.status = status
                        block.paied = true
                        this.moveToHistory(block)
                    } else {
                        block.status = status
                        this.moveToHistory(block)
                    }
                } else {
                    this.minerServer.mongoServer.updateMinedBlock(block._id, status)
                }
            }
        }
    }

    private async moveToHistory(block: IMinedBlock) {
        this.minerServer.mongoServer.deleteMinedBlock(block._id)
        this.minerServer.mongoServer.addMinedBlockHistory(block)
    }

    private async distributeIncome(block: IMinedBlock, reward: number) {
        try {
            const total = reward / 1000000000
            const poolFee = FC.POOL_FEE
            const salaries = total * (1 - poolFee)
            const length = block.addresses.length
            if (length !== block.shares.length) {
                return logger.error(`Invalid mined block ${block._id}`)
            }
            const totalShares = block.totalShares
            let paiedAmount = 0
            let amount = 0
            for (let i = length - 1; i >= 0; i--) {
                if (i === 0) {
                    amount = salaries - paiedAmount
                } else {
                    amount = salaries * (block.shares[i] / totalShares)
                    paiedAmount += amount
                }
                const signedTx = await this.makeTx(block.addresses[i], amount)
                await this.sendTx(signedTx)
            }
            logger.info(`Successful distribute block ${block._id}`)
        } catch (e) {
            logger.fatal(`income distribution failed: ${e}`)
        }
    }
    private async sendTx(signedTx: SignedTx) {
        const newTx = await this.minerServer.txpool.putTxs([signedTx])
        return this.minerServer.network.broadcastTxs(newTx)
    }
    private async makeTx(to: string, amount: number): Promise<SignedTx> {
        const minerFee = FC.MINER_FEE
        amount = amount - minerFee
        const nonce = await this.nextNonce(this.wallet)
        const toAddress = new Address(to)
        const signedTx = this.wallet.send(toAddress, hyconfromString(amount.toFixed(9)), nonce, hyconfromString(minerFee.toFixed(9)))
        logger.warn(`sending ${amount.toFixed(9)} HYC to ${toAddress} (${new Hash(signedTx).toString()})`)
        return signedTx
    }
    private async nextNonce(wallet: Wallet): Promise<number> {
        const address = wallet.pubKey.address()
        const account = await this.minerServer.consensus.getAccount(address)
        if (account === undefined) {
            return 0
        } else {
            const addressTxs = this.minerServer.txpool.getOutPendingAddress(address)
            let nonce: number
            if (addressTxs.length > 0) {
                nonce = addressTxs[addressTxs.length - 1].nonce + 1
            } else {
                nonce = account.nonce + 1
            }
            return nonce
        }
    }
    private async getUncleInfo(hashString: string): Promise<IUncleInfo | undefined> {
        return new Promise((resolve, reject) => {
            const path = FC.API_URL
            const endpoint = path + hashString
            try {
                request(endpoint, (err: any, res: any, body: any) => {
                    if (err) {
                        resolve(undefined)
                    } else {
                        const data = JSON.parse(body)
                        if (data.depth === undefined) {
                            resolve(undefined)
                        } else {
                            resolve(data)
                        }
                    }
                })
            } catch (err) {
                resolve(undefined)
            }
        })
    }
}
