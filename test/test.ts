import { RequestHandler } from '../src/main';
const rewire = require('rewire');

const timeoutRewire = rewire('../lib/main');
const timeout = timeoutRewire.__get__('timeout');

const mockedFetch = jest.fn();
mockedFetch.mockImplementation((url: string) => {
    return Date.now();
});

function policeRateLim(result: number[], rateLim: number, interval: number) {
    let res = true;
    result.forEach((req) => {
        const arr = result.filter((val) => (val >= req && (val - req) < interval));
        if (arr.length > rateLim) res = false;
    });
    return res;
}

function getRange(result: number[]) {
    const min = Math.min(...result);
    const max = Math.max(...result);
    if (min && max) {
        return max - min;
    } else {
        throw new Error('should not be undefined');
    }
}

describe('custom timeout function', () => {
    const testArray = [...Array(30).keys()].map(i => 100);
    testArray.forEach((t: number) => {
        test('timeout is at least specified time', async () => {
            const timeA = Date.now();
            const timeB: number = (await timeout(() => Date.now(), t)) as number;
            expect(timeB - timeA).toBeGreaterThanOrEqual(t);
        });
    })
});

describe('RequestHandler', () => {
    //Test by wrapping calls to fetch in a function that fails when there's too many requests in a certain time.
    // Parametrize both by nr. of reqs and interval to test the test also
    
    beforeEach(() => {
        mockedFetch.mockReset();
    });

    test('mock fetch is executed', async () => {
        const reqHandler = new RequestHandler(3, 1000);

        await reqHandler.get(async () => {
            return await mockedFetch(`testurl`);
        });

        expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    test('requests under limit are executed at once', async () => {
        mockedFetch.mockImplementation(() => Date.now());

        const reqHandler = new RequestHandler(3, 1000);
        const result: number[] = [];
        for(let i = 0; i  < 3; i++) {
            result.push(Number(await reqHandler.get(async () => {
                return await mockedFetch(`url${i}`);
            })))
        }

        expect(mockedFetch).toHaveBeenCalledTimes(3);
        expect(result.length).toBe(3);
        expect(mockedFetch).toHaveBeenNthCalledWith(1, 'url0');
        expect(mockedFetch).toHaveBeenNthCalledWith(2, 'url1');
        expect(mockedFetch).toHaveBeenNthCalledWith(3, 'url2');

        expect(getRange(result)).toBeLessThan(200);
    });

    test('requests over limit are delayed', async () => {
        mockedFetch.mockImplementation(() => Date.now());

        const reqHandler = new RequestHandler(3, 1005);
        const result: number[] = [];
        for(let i = 0; i  < 9; i++) {
            result.push(Number(await reqHandler.get(async () => {
                return await mockedFetch(`url${i}`);
            })));
        }
        expect(mockedFetch).toHaveBeenCalledTimes(9);
        expect(result.length).toEqual(9);
        expect(policeRateLim(result, 3, 1000)).toEqual(true);

    });

    function testErrors(pLength: number, totalTime: number, timesCalled: number, retryArg?: number) {
        test(`Retry on error with default exponential backoff ${retryArg} times`, async () => {
            mockedFetch.mockImplementation(() => {
                throw new Error('error123');
            });

            const reqHandler = new RequestHandler(3, pLength, retryArg);
            const result: number[] = [];
            let error;
            const timeA = Date.now();
            try{
                result.push(Number(await reqHandler.get(async () => {
                    return await mockedFetch(`url`);
                })));
            } catch(e) {
                error = e;
            }
            const delta = Date.now() - timeA;
            expect(delta).toBeLessThan(totalTime + 100);
            expect(delta).toBeGreaterThanOrEqual(totalTime);
            expect(error).toBeTruthy();
            expect(error.message).toEqual('error123');
            expect(mockedFetch).toHaveBeenCalledTimes(timesCalled);
            expect(result.length).toEqual(0);
        });
    }
    testErrors(100, 700, 4);
    testErrors(100, 3100, 6, 5);
    testErrors(100, 0, 1, 0);

    test('Requests return normally if resolved after backoff and backoff as function argument works', async () => {
        mockedFetch
        .mockImplementationOnce(() => {
            throw new Error('error123');
        })
        .mockImplementationOnce((url) => url);
        
        const reqHandler = new RequestHandler(1, 300, (err, nr) => {
            if (err.message === 'error123') {
                return 1300;
            } else {
                return undefined;
            }
        });

        let error;
        let result;
        const timeA = Date.now();
        try{
            result = await reqHandler.get(async () => {
                return await mockedFetch(`test_url`);
            });
        } catch(e) {
            error = e;
        }
        const delta = Date.now() - timeA;
        expect(error).toBeFalsy();
        expect(result).toEqual('test_url');
        expect(mockedFetch).toHaveBeenCalledTimes(2);
        expect(delta).toBeGreaterThanOrEqual(1300);
    });

    test('When backoff stops from a queue, function passes error upward, and promises work', async () => {
        mockedFetch
        .mockImplementation(() => {
            throw new Error('error123');
        })
        .mockImplementationOnce((url) => {
            return new Promise((res, rej) => {
                setTimeout(() => {
                    res(url); 
                });
            });
        });

        const reqHandler = new RequestHandler(1, 20);
        let error;
        let result;
        try{
            result = await reqHandler.get(async () => {
                return await mockedFetch(`test_url`);
            });
            await reqHandler.get(async () => {
                return await mockedFetch(`test_url`);
            });
        } catch(e) {
            error = e;
        }
        expect(error).toBeTruthy();
        expect(error.message).toEqual('error123');
        expect(result).toEqual('test_url');
        expect(mockedFetch).toHaveBeenCalledTimes(5);
    });
});