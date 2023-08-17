import { Context } from "koishi";
import { Config } from "..";
import { functionStatusPromise } from "../types/types";

export async function get(ctx: Context, url: string, params?: object, headers?: object, options?: object): functionStatusPromise {
    const config: Config = ctx.config

    try {
        const data = await ctx.http.get(url, {
            params: params,
            headers: headers,
            timeout: config.axiosConfig ? config.axiosTimeout : null,
            validateStatus: () => { return true },
            ...options
        })

        return {
            status: 0,
            data: data,
            msg: 'success'
        }

    } catch (error) {
        return {
            status: -1,
            msg: error
        }
    }
}