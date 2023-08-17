# 开始使用

## 使用本服务
在您所编写的插件的入口文件 (一般为 `index.ts/.js`) 中写入
<br> 更多详细使用方法, 请参阅 [koishi 文档 - 服务与依赖](https://koishi.chat/zh-CN/guide/plugin/service.html)
```ts
export const using = [
    'autoupdate',  // 如果你还需要其他服务, 您可以继续添加 item
]
```

## 注册监听器
在您所编写的插件的入口函数 (或其他可以访问 `ctx` 的位置) 中写入
```ts
const response = ctx.autoupdate.watch(<插件全名>(string), <轮询间隔>(number), <强制覆盖?>(boolean), <endpoint?>(string))
// 返回值:
// {
//    before: Function,  // 函数
//    off: Function
// }
```
* 插件全名 如 `koishi-plugin-systools`
* 轮询间隔 如 60000, 单位毫秒, 不推荐太快, 因为需要请求 `npmjs.com` 的 API
* 强制覆盖(选填, 默认 `false`) 在一般情况下, 一个插件只能有一个监听器, 如果您想覆盖已存在的监听器, 请将其设为 `true`
<br> 请注意, 如果其不为 `true` 并且已有一个同插件的监听器, 那么它将会抛出一个错误; 被覆盖后, 原有的所有监听函数都将失效.
* endpoint(选填, 默认使用 `market` 所设置的 endpoint) npm API 的地址, 如 `[https://]registry.npmjs.com`
* 函数返回值: `{ before: Function, off: Function }`, before 函数用于设置指定事件的回调函数, 具体详见下方
> 注意: 如果不指定事件的回调函数, 那么该事件的后续操作将自动执行.

## 注册监听函数
在上面的教程中, 我们知道了如何为指定插件创建事件监听器, 不过那么我们如何得知该插件有更新了呢?
<br> 下面是一个例子
```ts
// response 就是 ctx.autoupdate.watch 的返回值, 不需要 await
response.before(<事件名>, <回调函数>, <强制覆盖?>)
```
* 事件名详见 [此处](./events.md)
* 基本回调函数接受两个参数, 为 pluginName 和 eventName, 若其返回值为 true 则阻止后续操作, 附加参数详见 [事件 - 函数附加](./events.md)
* 强制覆盖(选填, 默认 `false`) 在一般情况下, 一个插件的一个事件只能有一个监听函数, 如果您想覆盖已存在的监听函数, 请将其设为 `true`
* <br> 请注意, 如果其不为 `true` 并且已有一个同插件的监听函数, 那么它将会抛出一个错误

> 您其实可以将注册监听器和监听函数一起写, 如 `ctx.autoupdate.watch(<插件全名>(string), <轮询间隔>(number), <强制覆盖?>(boolean), <endpoint?>(string)).before(<事件名>, <回调函数>, <强制覆盖?>)`

上述代码等价于
```ts
ctx.autoupdate.before(<插件全名>, <事件名>, <回调函数>, <强制覆盖?>)
```

## 注销监听函数
在上面的教程中, 我们知道了如何为指定插件的指定事件注册监听函数, 不过那么我们如何得取消注册呢?
<br> 下面是一个例子
```ts
// response 就是 ctx.autoupdate.watch 的返回值, 不需要 await
response.off(<事件名>, <忽略错误?>)
```
* 事件名详见 [此处](./events.md)
* 忽略错误(选填, 默认 `true`)
<br> 注意: 在 忽略错误 为 `false` 时, 如果指定插件不存在监听器或不存在监听函数, 那么它将会抛出一个错误

上述代码等价于
```ts
ctx.autoupdate.off(<插件全名>, <事件名>, <忽略错误?>)
```
