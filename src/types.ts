import { IncomingHttpHeaders, IncomingHttpStatusHeader } from 'http2';
import { HydroResponse } from './HydroResponse';
import { CookieJar } from 'tough-cookie';
import { Duplex, Readable } from 'stream';
import * as FormData from 'form-data';

export interface HydroHttpInitOptions {
    url: string;
    jar?: CookieJar;
}

export interface HydroResponseData {
    headers: IncomingHttpHeaders & IncomingHttpStatusHeader;
    flags?: number;
    data: Buffer | Duplex;
}
export type HydroResponseBody<T = any> = Buffer | Duplex | string | T;

export interface HydroRequestOptions {
    path: string;
    method?: string;
    qs?: Record<string, any>;
    decode?: HydroRequestDecodeOptions;
    headers?: object;
    jar?: CookieJar;
    strictCookies?: boolean;
    body?: HydroBody;
    form?: Record<string, any>;
    formData?: FormData | {[x: string]: HydroFormDataEntry};
}
export type HydroBody = Buffer | string | Readable;

export interface HydroFormDataEntry {
    value: string;
    options?: FormData.AppendOptions;
}

export enum DecodeMode {
    Buffer,
    String,
    JSON,
    Stream,
}

export interface HydroRequestDecodeOptions<T = any> {
    mode?: DecodeMode;
    transform?: (response: HydroResponse) => T;
    fullResponse?: boolean;
}
