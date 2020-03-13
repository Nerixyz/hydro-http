import { ClientHttp2Stream, constants, IncomingHttpHeaders } from 'http2';
import { DecodeMode, HydroRequestDecodeOptions, HydroResponseData } from './types';
import { Duplex } from 'stream';
import { createBrotliDecompress, createGunzip, createInflate, createUnzip } from 'zlib';
import { HydroResponse } from './HydroResponse';

export function handleRequestStream(
    stream: ClientHttp2Stream | Duplex,
    decodeOptions: HydroRequestDecodeOptions,
): Promise<HydroResponseData> {
    return new Promise((resolve, reject) => {
        // @ts-ignore -- is ClientHttp2Stream
        const initialStream: ClientHttp2Stream = stream;
        const response: Partial<HydroResponseData> = {
            headers: {},
            flags: 0,
            data: void 0,
        };
        stream.on('response', (headers, flags) => {
            stream = headers[constants.HTTP2_HEADER_CONTENT_ENCODING] ? addDecoder(stream, headers) : stream;
            delete headers[constants.HTTP2_HEADER_CONTENT_ENCODING];
            response.headers = headers;
            response.flags = flags;

            if (decodeOptions.mode === DecodeMode.Stream) {
                stream.on('end', () => initialStream.close());
                response.data = stream;
                if (isFullResponse(response)) resolve(response);
                else reject(new Error('Partial response'));
            } else {
                const responseParts: Buffer[] = [];
                stream.on('data', chunk => {
                    responseParts.push(chunk);
                });

                stream.on('error', err => {
                    reject(err);
                });

                stream.on('end', () => {
                    response.data = Buffer.concat(responseParts);
                    stream.end();
                    initialStream.close();
                    if (isFullResponse(response)) resolve(response);
                    else reject(new Error('Partial response'));
                });
            }
        });
    });
}

export function decodeToHydroResponse(
    raw: HydroResponseData,
    options: HydroRequestDecodeOptions,
): Promise<HydroResponse> {
    return new HydroResponse(raw, options).decode();
}

export async function fullHydroRequest(
    stream: ClientHttp2Stream,
    decodeOptions: HydroRequestDecodeOptions = {},
): Promise<HydroResponse> {
    return decodeToHydroResponse(await handleRequestStream(stream, decodeOptions), decodeOptions);
}

function isFullResponse(res: Partial<HydroResponseData>): res is HydroResponseData {
    return !!res.data && !!res.headers;
}

export function addDecoder(stream: ClientHttp2Stream | Duplex, headers: IncomingHttpHeaders): Duplex {
    switch (headers[constants.HTTP2_HEADER_CONTENT_ENCODING]) {
        case 'gzip': {
            return stream.pipe(createGunzip());
        }
        case 'deflate': {
            return stream.pipe(createInflate());
        }
        case 'br': {
            return stream.pipe(createBrotliDecompress());
        }
        case 'compress': {
            return stream.pipe(createUnzip());
        }
    }
    return stream;
}
