# HydroHttp

This is a basic Http/2 client for Node.js.
You can do most of the things you can do with Http 1.1 libraries but in Http/2.

Http/2 is different to 1.1 in the sense that you now have sessions,
allowing faster requests to the same host. 
That's the reason why you now have a request client holding the session/ connection to the host. 

# Features

-   Cookie support
-   Decompression
-   JSON decoding

# TODO

-   (Client-) Compression

# Usage

```typescript
import { HydroHttp } from 'hydro-http';
const client = await HydroHttp.init({
    url: 'https://example.com',
});
console.log(
    await client.simpleGet({
        path: '/',
        headers: {
            'User-Agent': 'me :)',
            'Accept-Encoding': 'gzip, deflate, br',
        },
    }),
);
```
