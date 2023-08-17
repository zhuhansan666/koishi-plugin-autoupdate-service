import { Context, Dict, Schema, Service } from 'koishi'
import { } from '@koishijs/plugin-help'
import { Installer } from '@koishijs/plugin-market'
import { } from '@koishijs/plugin-console'
import { gt } from 'semver'

import { logger } from './shared'
import { get } from './utils/axios'

export const name = 'autoupdate-service'
export const using = ['installer', 'console.config']
export const usage = '无需配置, 即刻启用'

export interface Config {
    axiosConfig: boolean,

    axiosTimeout: number
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        axiosConfig: Schema.boolean()
            .default(false)
    }).description('Axios Config'),
    Schema.union([
        Schema.object({
            axiosConfig: Schema.const(true)
                .required(),
            axiosTimeout: Schema.number()
                .min(5000)
                .default(30000)
        }),
        Schema.object({})
    ])
]).hidden(process.env.NODE_ENV !== 'development') as Schema<Config>

export function apply(ctx: Context, config: Config) {
    ctx.plugin(Autoupdate)
}

type EventNames = 'update' | 'reload'

type Event = {
    lastCall: number,
    watchInterval: number,
    callback: {
        update?: Function
        reload?: Function
    },
    endpoint?: string
}

class Autoupdate extends Service {
    static using = ['installer', 'console.config']

    private events: Dict<Event> = {}

    constructor(ctx: Context) {
        super(ctx, name.split('-')[0])  // 服务名称 autoupdate
    }

    get installer() {
        return this.ctx.installer
    }

    private async getLatestVersion(ctx: Context, installer: Installer, pluginName: string, endpoint?: string) {
        const _endpoint = new URL(endpoint ?? installer.endpoint ?? 'https://registry.npmjs.org/')

        const { status, data, msg } = await get(ctx, `${_endpoint.protocol}//${_endpoint.host}/${pluginName}/latest`)
        if (status || !data) {
            logger.warn(`获取 ${pluginName} 的最新版本错误: ${msg}`)
            return
        }

        return data.version
    }

    private checkVersion(latest: string, current: string): boolean {
        /**
         * 返回 false 代表已是最新版本
         * 
         * 即返回值 true 代表 有新的可用更新
         */
        if (!current || !latest) {
            return false
        }

        return gt(latest, current)
    }

    private async install(installer: Installer, deps: Dict<string>) {
        try {
            const status = await installer.install(deps)
            return status
        } catch (error) {
            logger.error(error)
            return error
        }
    }

    public async reload() {
        await (this.ctx.console.listeners['manager/app-reload'] as any).callback(this.ctx.loader.config)
    }

    private async loop() {
        const installer = this.installer
        const deps = await installer.getDeps()

        let requireReload = false

        for (const pluginName in this.events) {
            const value = this.events[pluginName]
            if (Date.now() - value.lastCall < value.watchInterval) {
                continue  // 小于 watchInterval 跳过
            }

            const latest = await this.getLatestVersion(this.ctx, installer, pluginName)
            const current = (deps[pluginName] ?? {}).resolved
            if (this.checkVersion(latest, current)) {
                try {
                    if (value.callback.update) {
                        const result = await value.callback.update(pluginName, 'update', latest, current)
                        if (result) {
                            value.lastCall = Date.now()
                            continue
                        }
                    }
                } catch (error) {
                    logger.debug(`运行 ${pluginName} 的 update 事件监听函数错误: ${error}`)
                }

                const _deps = {}
                _deps[pluginName] = latest

                if (await this.install(installer, _deps)) {
                    logger.warn(`安装 ${pluginName} 最新版本错误, 详见日志`)
                    continue
                }

                requireReload = true

                try {
                    if (value.callback.reload) {
                        const hookReload = await value.callback.reload(pluginName, 'reload')
                        if (hookReload && !requireReload) {
                            value.lastCall = Date.now()
                            continue
                        }

                        requireReload = true
                    } else {
                        requireReload = true
                    }
                } catch (error) {
                    logger.debug(`运行 ${pluginName} 的 reload 事件监听函数错误: ${error}`)
                }

                value.lastCall = Date.now()
            }
        }

        if (requireReload) {
            try {
                await this.reload()
            } catch (error) {
                logger.warn(`重载失败: ${error}`)
            }
        }

        setTimeout(() => {  // 如果直接 把 this.loop 传进去会导致 this 成为 undefined
            this.loop()
        }, 50)  // 使用 setTimeout 实现 setInterval
    }

    public watch(pluginName: string, watchInterval: number, force?: boolean, endpoint?: string) {
        /**
         * @param pluginName 例如 koishi-plugin-systools
         * @param watchInterval 轮询间隔, 毫秒
         * @param force 强制覆盖原有监听器
         * @param endpoint npm API, 例如 registry.npmjs.com
         */
        if (this.events[pluginName] && !force) {
            throw Error(`${pluginName} 监听器已存在, 使用 force=true 以强制覆盖`)
        }

        const caller = this.caller
        caller.on('dispose', () => {
            this.unwatch(pluginName)
        })

        if (watchInterval < 1000) {
            logger.warn(`轮询间隔小于 1 秒可能导致 koishi 无法正常工作`)
        }

        this.events[pluginName] = {
            lastCall: 0,
            watchInterval: watchInterval,
            callback: {},
            endpoint: endpoint
        }

        return {
            before: (eventName: EventNames, callback: Function, force?: boolean) => {
                /**
                 * @param callback 接受两个参数, 为 pluginName 和 eventName, 若其返回值为 true 则阻止后续操作, 附加参数详见 事件 - 函数附加
                 */
                this.before(pluginName, eventName, callback, force)
            },
            off: (eventName: EventNames, ignoreError: boolean = true) => {
                this.off(pluginName, eventName, ignoreError)
            }
        }
    }

    public unwatch(pluginName: string, ignoreError: boolean = true) {
        if (!this.events[pluginName] && !ignoreError) {
            throw Error(`${pluginName} 的监听器不存在`)
        }

        delete this.events[pluginName]
    }


    public before(pluginName: string, eventName: EventNames, callback: Function, force?: boolean) {
        const caller = this.caller
        caller.on('dispose', () => {
            this.off(pluginName, eventName)
        })

        if (this.events[pluginName] && this.events[pluginName].callback[eventName] && !force) {
            throw Error(`${pluginName} 的 ${eventName} 监听函数已存在, 使用 force=true 以强制覆盖`)
        }

        this.events[pluginName].callback[eventName] = callback
    }

    public off(pluginName: string, eventName: EventNames, ignoreError: boolean = true) {
        if (!this.events[pluginName]) {
            if (!ignoreError) {
                throw Error(`${pluginName} 监听器不存在`)
            }
        } else if (!this.events[pluginName].callback[eventName] && !ignoreError) {
            throw Error(`${pluginName} 的 ${eventName} 监听函数不存在`)
        }

        if (this.events[pluginName] && this.events[pluginName].callback && this.events[pluginName].callback[eventName]) {
            this.events[pluginName].callback[eventName] = null
        }
    }

    public override async start() {  // 在 ready 事件触发时调用
        this.loop()
    }
}

Context.service(name.split('-')[0], Autoupdate)  // 注册服务
declare module 'koishi' {  // 声明合并
    interface Context {
        autoupdate: Autoupdate
    }
}
