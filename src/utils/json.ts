export function toString(data: object | string): string {
    if (typeof data == 'string') {
        return data
    }

    try {
        return JSON.stringify(data)
    } catch(error) {
        console.log(error)
        return null
    }
}

export function toObject(data: string | any): object {
    try {
        return JSON.parse(data)
    } catch(error) {
        return null
    }
}