import { Cookie, CookieJar } from 'tough-cookie';
import { Readable } from "stream";
import { ClientHttp2Stream } from "http2";
import { defaultsDeep } from 'lodash';

export function getCookieStringAsync(jar: CookieJar, url: string): Promise<string> {
    return new Promise<string>((resolve, reject) =>
        jar.getCookieString(url, (err, cookies) => (err ? reject(err) : resolve(cookies))),
    );
}

export function setCookieAsync(jar: CookieJar, cookie: Cookie | string, url: string) {
    return new Promise<void>((resolve, reject) =>
        jar.setCookie(cookie, url, err => (err ? reject(err) : resolve())),
    );
}

export function pipeBodyToStream(body: Buffer | string | Readable, stream: ClientHttp2Stream) {
    if(body instanceof Buffer) {
        return writeToStreamAsync(stream, body);
    } else if(typeof body === 'string') {
        return writeToStreamAsync(stream, body, 'utf8');
    } else {
        return body.pipe(stream);
    }
}

export function writeToStreamAsync(stream: ClientHttp2Stream, data: any, encoding?: string): Promise<void> {
    return new Promise<void>((resolve, reject) => stream.write(data, encoding, error => error ? reject(error) : resolve()));
}

export function forceDeep<T>(target: T, toForce: Partial<T>): T {
    return defaultsDeep(toForce, target);
}

/**
 * Removes the case on an object, this only works on one level
 * @param {T} object
 * @returns {T}
 */
export function caseless<T>(object: T): T {
    return Object.fromEntries(Object.entries(object).map(([key, value]) => [key.toLowerCase(), value]));
}
