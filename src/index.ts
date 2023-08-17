import { Context, Dict, Schema, Service } from 'koishi'
import { Installer } from '@koishijs/plugin-market'
import { } from '@koishijs/plugin-console'
import { gt } from 'semver'

import { logger } from './shared'
import { get } from './utils/axios'

export const name = 'autoupdate-service'

export interface Config {
    axiosConfig: boolean,

    axiosTimeout: number
}

export const Config: Schema<Config> = (Schema.intersect([
    Schema.object({
        axiosConfig: Schema.boolean()
            .default(false)
    }),
    Schema.union([
        Schema.object({
            axiosConfig: Schema.const(true)
                .required(),
            axiosTimeout: Schema.number()
                .min(5000)
                .default(30000)
        })
    ])
]) as Schema<Config>)
    .hidden(process.env.NODE_ENV !== 'development')

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
    private context: Context

    constructor(ctx: Context) {
        super(ctx, name.split('-')[0])  // 服务名称 autoupdate
        this.context = ctx
    }

    get installer() {
        return this.ctx.installer
    }

    private async getLatestVerison(ctx: Context, installer: Installer, pluginName: string, endpoint?: string) {
        const _endpoint = new URL(endpoint ?? installer.endpoint ?? 'https://registry.npmjs.org/')

        const { status, data, msg } = await get(ctx, `${_endpoint.protocol}${_endpoint.host}/${pluginName}/latest`)
        if (status || !data) {
            logger.warn(`获取 ${pluginName} 的最新版本错误: ${msg}`)
            return
        }

        return (data.data ?? {}).verison
    }

    private checkVersion(latest: string, current: string): boolean {
        /**
         * 返回 false 代表已是最新版本
         * 
         * 即返回值 true 代表 有新的可用更新
         */
        if (!latest || !current) {
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
        await (this.context.console.listeners['manager/app-reload'] as any).callback()
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

            const latest = await this.getLatestVerison(this.context, installer, pluginName)
            const current = deps[pluginName].resolved
            if (this.checkVersion(latest, current)) {
                try {
                    if (value.callback.update) {
                        const result = await value.callback.update(pluginName, 'update', latest, current)
                        if (result) {
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

                try {
                    if (value.callback.reload) {
                        const hookReload = await value.callback.reload(pluginName, 'reload')
                        if (hookReload && !requireReload) {
                            continue
                        }

                        requireReload = true
                    }
                } catch(error) {
                    logger.debug(`运行 ${pluginName} 的 reload 事件监听函数错误: ${error}`)
                }

                value.lastCall = Date.now()
            }
        }

        if (requireReload) {
            try {
                await this.reload()
            } catch(error) {
                logger.warn(`重载失败: ${error}`)
            }
        }

        setTimeout(this.loop, 5)  // 使用 setTimeout 实现 setInterval
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

    public before(pluginName: string, eventName: EventNames, callback: Function, force?: boolean) {
        if (this.events[pluginName] && this.events[pluginName].callback[eventName] && !force) {
            throw Error(`${pluginName} 的 ${eventName} 监听函数已存在, 使用 force=true 以强制覆盖`)
        }

        this.events[pluginName].callback[eventName] = callback
    }

    public off(pluginName: string, eventName: EventNames, ignoreError: boolean = true) {
        if (!this.events[pluginName] && !this.events[pluginName].callback[eventName] && !ignoreError) {
            throw Error(`${pluginName} 的 ${eventName} 监听函数不存在`)
        }

        this.events[pluginName].callback[eventName] = null
    }

    public override stop() {  // 在 dispose 事件触发时调用
    }

}

Context.service(name.split('-')[0], Autoupdate)  // 注册服务
declare module 'koishi' {  // 声明合并
    interface Context {
        autoupdate: Autoupdate
    }
}
