import { CustomError } from 'ts-custom-error';

export class CookieError extends CustomError {
    constructor(public innerErrors: Error[], message?: string) {
        super(message);
    }
}
