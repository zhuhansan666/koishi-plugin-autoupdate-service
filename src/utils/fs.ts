import { writeFile as fsWriteFile, readFile as fsReadFile, stat, mkdir, unlink } from "fs/promises"
import { existsSync } from "fs"
import path from "path"

import { functionStatusPromise } from "../types/types"
import { toString, toObject } from "./json"
import { logger } from "../shared"

export async function writeFile(file: string, data: string | object, encoding?: BufferEncoding, options?): functionStatusPromise {
    const parseObject = path.parse(file)

    const dir = parseObject.dir
    if (!existsSync(dir)) {
        try {
            await mkdir(dir, { recursive: true })
        } catch (error) {
            logger.debug(`创建文件夹失败: ${error}`)
            return {
                status: -1,
                data: 'create dir',
                msg: error
            }
        }
    } else if (!(await stat(dir)).isDirectory()) {
        try {
            await unlink(dir)
            await mkdir(dir, { recursive: true })
        } catch (error) {
            logger.debug(`删除文件或创建文件夹失败: ${error}`)
            return {
                status: -2,
                data: 'remove file or create dir',
                msg: error
            }
        }
    }

    try {
        data = toString(data)
    } catch (error) {
        logger.debug(`转换内容失败: ${error}`)
        return {
            status: -4,
            data: 'stringify data',
            msg: error
        }
    }

    try {
        await fsWriteFile(file, data, { encoding: encoding ?? 'utf-8', ...options })
        return {
            status: 0,
            msg: 'success'
        }
    } catch (error) {
        logger.debug(`文件写入失败: ${error}`)
        return {
            status: -3,
            data: 'write file',
            msg: error
        }
    }
}

export async function readFile(file: string, encoding?: BufferEncoding, options?): functionStatusPromise {
    try {
        const data = await fsReadFile(file, { encoding: encoding ?? 'utf-8', ...options })
        return {
            status: 0,
            data: toObject(data) ?? data,
            msg: 'success'
        }
    } catch (error) {
        return {
            status: -1,
            msg: error
        }
    }
}