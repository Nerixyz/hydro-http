import { connect as http2connect, ClientHttp2Session, constants, ClientHttp2Stream } from 'http2';
import { format, parse } from 'url';
import { HydroBody, HydroHttpInitOptions, HydroRequestOptions } from './types';
import * as querystring from 'querystring';
import { Cookie, CookieJar } from 'tough-cookie';
import { CookieError } from './errors';
import { HydroResponse } from './HydroResponse';
import { HydroRequest } from './HydroRequest';
import { Readable } from 'stream';
import * as FormData from 'form-data';

export class HydroHttp {
    constructor(protected session: ClientHttp2Session, protected options: HydroHttpInitOptions) {}

    public static initSync(options: HydroHttpInitOptions): HydroHttp {
        return new HydroHttp(http2connect(options.url), options);
    }

    public static init(options: HydroHttpInitOptions): Promise<HydroHttp> {
        return new Promise<HydroHttp>(resolve =>
            http2connect(options.url, session =>
                resolve(
                    new HydroHttp(session, {
                        ...options,
                    }),
                ),
            ),
        );
    }

    public async request(options: HydroRequestOptions): Promise<HydroResponse> {
        let path = options.path;
        let qs = options.qs;
        if (path.includes('?')) {
            const res = parse(path, true);
            qs = {
                ...res.query,
                ...options.qs,
            };
            path = res.pathname ?? '/';
        }
        if (qs) {
            qs = this.stringifyValues(qs);
            path = `${path}?${querystring.stringify(qs)}`;
        }
        const headers = this.stringifyHeaders(options.headers ?? {});
        const setHeaderNoExist = (name: string, value: string | string[] | any) => !headers[name] && (headers[name] = value);
        (this.options.jar || options.jar) && setHeaderNoExist(constants.HTTP2_HEADER_COOKIE, (await HydroHttp.getCookieStringAsync(
            // @ts-ignore -- jar is CookieJar
            options.jar ?? this.options.jar,
            format({
                host: this.options.url,
                path: path,
            }),
        )) || undefined);
        let body: HydroBody | undefined = options.body;
        if(!body) {
            if (options.form) {
                body = Buffer.from(querystring.encode(this.stringifyValues(options.form)));
                !options.method && setHeaderNoExist(constants.HTTP2_HEADER_METHOD, 'POST');
                setHeaderNoExist(constants.HTTP2_HEADER_CONTENT_LENGTH, body.byteLength.toString());
                setHeaderNoExist(constants.HTTP2_HEADER_CONTENT_TYPE, 'application/x-www-form-urlencoded');
            } else if(options.formData) {
                let form;
                if(options.formData instanceof FormData) {
                    form = options.formData;
                } else {
                    form = new FormData();
                    for(const [key, value] of Object.entries(options.formData)) {
                        form.append(key, value.value, value.options);
                    }
                }
                !options.method && setHeaderNoExist(constants.HTTP2_HEADER_METHOD, 'POST');
                setHeaderNoExist(constants.HTTP2_HEADER_CONTENT_TYPE, 'multipart/form-data');
                Object.entries(form.getHeaders()).forEach(([k, v]) => headers[k] = v);
                body = form;
            }
        }
        const stream = this.session.request({
            [constants.HTTP2_HEADER_PATH]: path,
            [constants.HTTP2_HEADER_METHOD]: options.method ?? 'GET',
            ...headers,
        });
        if(body) {
            await HydroHttp.pipeBodyToStream(body, stream);
        }
        const response = await new HydroRequest(
            stream,
            options.decode,
        ).execute();
        await this.handleResponse(response, options);
        return response;
    }

    public close() {
        return this.session.close();
    }

    protected async handleResponse(response: HydroResponse, reqOptions: HydroRequestOptions) {
        if (reqOptions.jar || this.options.jar) {
            const href = parse(this.options.url);
            const cookies = response.headersAsArray(constants.HTTP2_HEADER_SET_COOKIE);
            const res1 = (await this.putCookiesIntoJar(reqOptions.jar, cookies, href.href))?.filter(x => !!x);
            const res2 = (await this.putCookiesIntoJar(this.options.jar, cookies, href.href))?.filter(x => !!x);
            if (reqOptions.strictCookies && (res1?.length || res2?.length)) {
                // @ts-ignore -- one will be full
                throw new CookieError([...(res1 || []), ...(res2 || [])], "Some cookies couldn't be set");
            }
        }
    }

    protected putCookiesIntoJar(jar: CookieJar | undefined, cookies: string[], url: string) {
        if (!jar) return;
        return Promise.all<Error | undefined>(
            cookies.map(cookie => HydroHttp.setCookieAsync(jar, cookie, url).catch(e => e)),
        );
    }

    protected stringifyValues(obj: object): Record<string, string> {
        return Object.fromEntries(
            Object.entries(obj).map(([key, value]) => [
                key,
                typeof value === 'object' ? JSON.stringify(value) : value.toString(),
            ]),
        );
    }

    protected stringifyHeaders(obj: object): Record<string, string> {
        return Object.fromEntries(
            Object.entries(obj).map(([key, value]) => [
                key,
                typeof value === 'object' ? (Array.isArray(value) ? value : JSON.stringify(value)) : value.toString(),
            ]),
        );
    }

    protected static getCookieStringAsync(jar: CookieJar, url: string): Promise<string> {
        return new Promise<string>((resolve, reject) =>
            jar.getCookieString(url, (err, cookies) => (err ? reject(err) : resolve(cookies))),
        );
    }

    protected static setCookieAsync(jar: CookieJar, cookie: Cookie | string, url: string) {
        return new Promise<void>((resolve, reject) =>
            jar.setCookie(cookie, url, err => (err ? reject(err) : resolve())),
        );
    }

    protected static pipeBodyToStream(body: Buffer | string | Readable, stream: ClientHttp2Stream) {
        if(body instanceof Buffer) {
            return this.writeToStreamAsync(stream, body);
        } else if(typeof body === 'string') {
           return this.writeToStreamAsync(stream, body, 'utf8');
        } else {
           return body.pipe(stream);
        }
    }

    protected static writeToStreamAsync(stream: ClientHttp2Stream, data: any, encoding?: string): Promise<void> {
        return new Promise<void>((resolve, reject) => stream.write(data, encoding, error => error ? reject(error) : resolve()));
    }
}
