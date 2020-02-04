import { randomBytes } from "crypto"
import Long = require("long")
import { Block } from "../common/block"
import { BlockHeader } from "../common/blockHeader"
import { Hash } from "../util/hash"

export interface IJob {
    block: Block
    id: number
    prehash: Uint8Array
    prehashHex: string
    minerReward: number
    target: Buffer
    targetHex: string
    solved: boolean
}

export interface IWorker {
    _id: string
    name: string
    socket: any
    address: string
    shares: number
    ip: string
    tick: number
    hashrate: number
}

export interface IMinedBlock {
    _id: string
    status: string
    prevHash: string
    timestamp: number
    addresses: string[]
    shares: number[]
    paied: boolean
    totalShares: number,
    reward: number
}

export interface IPool {
    hashrate: number,
    tick: number,
}

export interface INetwork {
    fee: number
    poolDiff: number,
    reward: number,
    hashrate: number,
    blockGap: number,
    tick: number
}

export interface IUncleInfo {
    height: number,
    depth: number,
    uncleHash: string,
    miner: string,
    difficulty: number,
    uncleTimeStamp: number
}

export function hexToLongLE(val: string): Long {
    const buf = new Uint8Array(Buffer.from(val, "hex"))
    let high = 0
    let low = 0
    for (let idx = 7; idx >= 4; --idx) {
        high *= 256
        high += buf[idx]
        low *= 256
        low += buf[idx - 4]
    }
    return new Long(low, high, true)
}

// get random number between [1, maximum]
export function getRandomIndex(maximum: number): number {
    return Math.floor(Math.random() * maximum) + 1
}

export function testBlock(difficulty: number) {
    const fakeBlock = new Block({
        header: new BlockHeader({
            difficulty,
            merkleRoot: new Hash(randomBytes(32)),
            miner: new Uint8Array(20),
            nonce: -1,
            previousHash: [new Hash(randomBytes(32))],
            stateRoot: new Hash(randomBytes(32)),
            timeStamp: Date.now(),
        }),
        txs: [],
    })
    return fakeBlock
}

export function sma(num: number, prevNum: number, size: number) {
    return (prevNum * (size - 1) + num) / size
}
