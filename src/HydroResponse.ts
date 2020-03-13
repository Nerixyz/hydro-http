import { DecodeMode, HydroRequestDecodeOptions, HydroResponseData } from './types';
import { IncomingHttpHeaders, IncomingHttpStatusHeader } from 'http2';
import { Enumerable } from './Enumerable';
import { Duplex } from 'stream';

export class HydroResponse<T = any> {
    @Enumerable(false)
    protected raw: HydroResponseData;

    public body: T | Buffer | Duplex | string;
    public headers: IncomingHttpHeaders & IncomingHttpStatusHeader;

    constructor(raw: HydroResponseData, protected decodeOptions: HydroRequestDecodeOptions<T>) {
        this.raw = raw;
        this.body = this.raw.data;
        this.headers = raw.headers;
    }

    public async decode(): Promise<this> {
        if(this.decodeOptions.mode === DecodeMode.Stream)
            return this;

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
        if(!Buffer.isBuffer(this.body))
            return;
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

export class HydroJsonResponse<T = any> extends HydroResponse {
    public body: T;
}

export class HydroStringResponse extends HydroResponse {
    public body: string;
}

export class HydroBufferResponse extends HydroResponse {
    public body: Buffer;
}
