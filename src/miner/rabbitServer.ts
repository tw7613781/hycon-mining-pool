import { Channel, connect, Connection } from "amqplib"
import { getLogger } from "log4js"
import { FC } from "./config"
const logger = getLogger("RabbitMQ")
export class RabbitmqServer {
    private conn: Connection = undefined
    private channel: Channel = undefined
    private exchangeName: string
    private url: string
    public constructor(exchangeName: string) {
        this.url = FC.URL_RABBITMQ_SERVICE
        if (exchangeName !== undefined) { this.exchangeName = exchangeName }
    }
    public async initialize() {
        logger.info(`Server ${this.url}  Queue ${this.exchangeName}`)
        this.conn = await connect(this.url)
        this.channel = await this.conn.createChannel()
        this.channel.assertExchange(this.exchangeName, "fanout", { durable: false })
    }
    public finalize() {
        this.conn.close()
    }
    public async receive(callback: (msg: any) => void) {
        const tmpQueue = await this.channel.assertQueue("", { exclusive: true })
        this.channel.bindQueue(tmpQueue.queue, this.exchangeName, "")
        this.channel.consume(
            tmpQueue.queue,
            callback,
            { noAck: true },
        )
    }
    public send(msg: any) {
        // second params "" means all queues ==> broadcasting
        if (this.channel !== undefined) { this.channel.publish(this.exchangeName, "", Buffer.from(msg)) }
    }
}
