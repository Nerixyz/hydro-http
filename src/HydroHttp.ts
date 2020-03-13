import { connect as http2connect, ClientHttp2Session, constants, ClientHttp2Stream } from 'http2';
import { format, parse } from 'url';
import { HydroBody, HydroHttpInitOptions, HydroRequestOptions, HydroResponseBody } from './types';
import * as querystring from 'querystring';
import { CookieJar } from 'tough-cookie';
import { CookieError } from './errors';
import { HydroResponse } from './HydroResponse';
import * as FormData from 'form-data';
import { caseless, forceDeep, getCookieStringAsync, pipeBodyToStream, setCookieAsync } from './utilities';
import { fullHydroRequest } from './core';
import { pull } from 'lodash';

export class HydroHttp {

    protected activeRequests: ClientHttp2Stream[] = [];

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

    public async request<T extends HydroResponseBody | HydroResponse = HydroResponseBody>(options: HydroRequestOptions): Promise<T> {
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
        const headers = caseless(this.stringifyHeaders(options.headers ?? {}));
        const setHeaderNoExist = (name: string, value: string | string[] | any) => !headers[name] && (headers[name] = value);
        (this.options.jar || options.jar) && setHeaderNoExist(constants.HTTP2_HEADER_COOKIE, (await getCookieStringAsync(
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
        this.activeRequests.push(stream);
        if(body) {
            await pipeBodyToStream(body, stream);
        }
        const response = await fullHydroRequest(
            stream,
            options.decode,
        );
        await this.handleResponse(response, options);
        this.activeRequests = pull(this.activeRequests, stream);
        // @ts-ignore -- this is assignable
        return options.decode?.fullResponse ? response : response.body;
    }

    public get<T = any>(options: HydroRequestOptions): Promise<HydroResponse<T> | HydroResponseBody> {
        return this.request(forceDeep(options, {method: 'GET'}));
    }

    public post<T = any>(options: HydroRequestOptions): Promise<HydroResponse<T> | HydroResponseBody> {
        return this.request(forceDeep(options, {method: 'POST'}));
    }

    public fullRequest<T = any>(options: HydroRequestOptions): Promise<HydroResponse<T>> {
        return this.request(forceDeep(options, {decode: {fullResponse: true}}))
    }

    public fullGet<T = any>(options: HydroRequestOptions): Promise<HydroResponse<T>> {
        // @ts-ignore -- only returns response obj
        return this.get<T>(forceDeep(options, {decode: {fullResponse: true}}))
    }

    public fullPost<T = any>(options: HydroRequestOptions): Promise<HydroResponse<T>> {
        // @ts-ignore -- only returns response obj
        return this.post<T>(forceDeep(options, {decode: {fullResponse: true}}))
    }

    public simpleRequest<T = any>(options: HydroRequestOptions): Promise<HydroResponseBody<T>> {
        return this.request(forceDeep(options, {decode: {fullResponse: false}}))
    }

    public simpleGet<T = any>(options: HydroRequestOptions): Promise<HydroResponseBody<T>> {
        // @ts-ignore -- only returns response body
        return this.get<T>(forceDeep(options, {decode: {fullResponse: false}}))
    }

    public simplePost<T = any>(options: HydroRequestOptions): Promise<HydroResponseBody<T>> {
        // @ts-ignore -- only returns response body
        return this.post<T>(forceDeep(options, {decode: {fullResponse: false}}))
    }

    public close() {
        this.activeRequests.forEach(request => request.close());
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
                throw new CookieError([...(res1 || []), ...(res2 || [])], 'Some cookies could not be set');
            }
        }
    }

    protected putCookiesIntoJar(jar: CookieJar | undefined, cookies: string[], url: string) {
        if (!jar) return;
        return Promise.all<Error | undefined>(
            cookies.map(cookie => setCookieAsync(jar, cookie, url).catch(e => e)),
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
}
