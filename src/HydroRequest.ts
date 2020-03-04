import { ClientHttp2Stream } from 'http2';
import { HydroRequestDecodeOptions, HydroResponseData } from './types';
import { HydroResponse } from './HydroResponse';

export class HydroRequest<T extends string | Buffer | object> {
    constructor(protected stream: ClientHttp2Stream, protected decodeOptions: HydroRequestDecodeOptions = {}) {}

    public async execute(): Promise<HydroResponse<T>> {
        const data: Buffer[] = [];
        const response: HydroResponseData = {
            headers: {},
            data: Buffer.alloc(0),
        };
        return new Promise<HydroResponse<T>>((resolve, reject) => {
            this.stream.on('response', (headers, flags) => {
                response.headers = headers;
                response.flags = flags;
            });
            this.stream.on('data', (chunk: Buffer | string) => {
                data.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
            });
            this.stream.on('error', (error: Error) => {
                this.cleanup();
                reject(error);
            });
            this.stream.on('end', () => {
                this.cleanup();
                resolve(this.handleResponse({
                    ...response,
                    data: Buffer.concat(data),
                }));
            });
        });
    }

    protected async handleResponse(response: HydroResponseData): Promise<HydroResponse<T>> {
        this.cleanup();
        return new HydroResponse(response, this.decodeOptions).decode();
    }

    protected cleanup() {
        this.stream.end();
    }
}
