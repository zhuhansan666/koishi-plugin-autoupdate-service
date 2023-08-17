export type functionStatus = {
    status: number  // 0 -> no error
    data?: any  // the function result
    msg: 'success' | Error  // the error object
}

export type functionStatusPromise = Promise<functionStatus>
