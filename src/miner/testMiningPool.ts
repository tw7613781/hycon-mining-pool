import { configure, getLogger } from "log4js"
import { MongoServer } from "./mongoServer"
import { StratumServer } from "./stratumServer"

configure({
    appenders: {

        console: {
            type: "log4js-protractor-appender",
        },
        fileLogs: {
            filename: `./logs/${new Date().getFullYear()}-${(new Date().getMonth()) + 1}-${new Date().getDate()}/logFile.log`,
            keepFileExt: true,
            maxLogSize: 16777216,
            pattern: ".yyyy-MM-dd",
            type: "dateFile",
        },
    },
    categories: {
        default: { appenders: ["console", "fileLogs"], level: "debug" },
    },
})

const mongodb = new MongoServer()
const stratumServer = new StratumServer(mongodb, true)
