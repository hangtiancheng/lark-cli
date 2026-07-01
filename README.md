lark-cli.code-workspace

```json
{
  "folders": [
    {
      "name": "lark-cli",
      "path": "./"
    },
    {
      "name": "reference",
      "path": "/Users/whoami/Downloads/reference"
    }
  ]
}
```

## TODO

Compare typescript `ThisType<T>` and `ThisParameterType<T>`

### `ThisType<T>`

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toTry<T extends (...args: any) => any>(fn: T, ctx?: ThisParameterType<T>) {
  if (typeof fn !== "function") {
    return fn;
  }
  return function (
    this: ThisParameterType<T>,
    ...args: Parameters<T>
  ): ReturnType<T> | undefined {
    let ret: ReturnType<T>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      ret = ctx ? fn.call(ctx, ...args) : fn.call(this, ...args);
    } catch (e) {
      console.error(e);
      return undefined;
    }
    return ret;
  };
}
```
