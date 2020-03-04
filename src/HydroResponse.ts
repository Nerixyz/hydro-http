import { HydroRequestDecodeOptions, HydroResponseData, DecodeMode } from './types';
import { IncomingHttpHeaders, IncomingHttpStatusHeader, constants } from 'http2';
import { promisify } from 'util';
import { brotliDecompress, BrotliOptions, gunzip, inflate, ZlibOptions } from 'zlib';
import { Enumerable } from './Enumerable';
const gunzipAsync = promisify((buffer: Buffer, options: ZlibOptions, cb: (err: Error | null, res: Buffer) => void) =>
    gunzip(buffer, options, cb),
);
const inflateAsync = promisify((buffer: Buffer, options: ZlibOptions, cb: (err: Error | null, res: Buffer) => void) =>
    inflate(buffer, options, cb),
);
const brotliAsync = promisify((buffer: Buffer, options: BrotliOptions, cb: (err: Error | null, res: Buffer) => void) =>
    brotliDecompress(buffer, options, cb),
);

export class HydroResponse<T = any> {
    @Enumerable(false)
    protected raw: HydroResponseData;

    public body: T | Buffer | string;
    public headers: IncomingHttpHeaders & IncomingHttpStatusHeader;

    constructor(raw: HydroResponseData, protected decodeOptions: HydroRequestDecodeOptions<T>) {
        this.raw = raw;
        this.headers = raw.headers;
    }

    public async decode(): Promise<this> {
        await this.decodeResponse(this.decodeOptions.mode ?? this.getDecodeMode());
        if (this.decodeOptions.transform) {
            this.body = this.decodeOptions.transform(this);
        }
        return this;
    }

    protected getDecodeMode(): DecodeMode {
        const [mainType, subType] = (
            this.raw.headers?.['content-type']?.match(/[A-Za-z0-9\-_*]+\/[A-Za-z0-9\-_*]+/)?.[0] ?? '/'
        ).split('/');
        if (mainType === 'text') {
            return DecodeMode.String;
        }
        if (mainType === 'application' && subType === 'json') {
            return DecodeMode.JSON;
        }
        return DecodeMode.Buffer;
    }

    protected async decodeResponse(mode: DecodeMode) {
        const encoding = this.headerString(constants.HTTP2_HEADER_CONTENT_ENCODING, '');
        if (encoding) {
            switch (encoding) {
                case 'gzip': {
                    this.raw.data = await gunzipAsync(this.raw.data, {});
                    break;
                }
                case 'deflate': {
                    this.raw.data = await inflateAsync(this.raw.data, {});
                    break;
                }
                case 'br': {
                    this.raw.data = await brotliAsync(this.raw.data, {});
                    break;
                }
            }
        }
        switch (mode) {
            case DecodeMode.Buffer:
                this.body = this.raw.data;
                break;
            case DecodeMode.String:
                this.body = this.raw.data.toString();
                break;
            case DecodeMode.JSON:
                this.body = JSON.parse(this.raw.data.toString());
                break;
        }
    }

    public header(key: string): string | string[] | null {
        return this.headers[key] ?? null;
    }

    public headerString(key: string, orElse: string): string;
    public headerString(key: string, orElse?: string): string | null {
        const header = this.header(key);
        if (!header) return orElse ?? null;
        if (typeof header !== 'string') return header[0];
        return header;
    }

    public headersAsArray(key: string): string[] {
        const res = this.header(key);
        if (!res) return [];
        if (typeof res === 'string') return [res];
        return res;
    }
}
