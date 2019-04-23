export default class CallHandler {
    constructor(rateLim: number, periodLength: number, backoff?: ((error: Error, attemptNr: number) => number | undefined) | number);
    call(func: Function): Promise<object>;
}
