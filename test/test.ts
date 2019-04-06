import { RequestHandler } from '../src/main';

jest.mock('node-fetch');
import fetch from 'node-fetch';

const mockedFetch = fetch as jest.Mocked<any>;
mockedFetch.mockImplementation((url: string) => {
    return {
        json: () => Date.now(),
    };
});

function policeRateLim(result: number[], rateLim: number, interval: number) {
    let res = true;
    result.forEach((req) => {
        const arr = result.filter((val) => (val >= req && (val - req) < interval));
        if (arr.length > rateLim) res = false;
    });
    return res;
}

describe('RequestHandler', () => {
    //Test by wrapping calls to fetch in a function that fails when there's too many requests in a certain time.
    // Parametrize both by nr. of reqs and interval to test the test also
    
    beforeEach(() => {
        mockedFetch.mockClear();
    });

    test('mock fetch is executed', async () => {
        const reqHandler = new RequestHandler(3, 1000);

        await reqHandler.get({ url: `testurl`});

        expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('requests under limit are executed at once', async () => {
        const reqHandler = new RequestHandler(3, 1000);

        const result: number[] = [];
        for(let i = 0; i  < 3; i++) {
            result.push(Number(await reqHandler.get({ url: `url${i}`})))
            // await new Promise((res) => setTimeout(() => res(), 100));
        }
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(result.length).toBe(3);
        expect(fetch).toHaveBeenNthCalledWith(1, 'url0');
        expect(fetch).toHaveBeenNthCalledWith(2, 'url1');
        expect(fetch).toHaveBeenNthCalledWith(3, 'url2');

        const min = Math.min(...result);
        const max = Math.max(...result);
        if (min && max) {
            expect(max - min).toBeLessThan(100);
        } else {
            throw new Error('should not be undefined');
        }
    });

    test('requests over limit are delayed', async () => {
        const reqHandler = new RequestHandler(3, 1005);

        const result: number[] = [];
        for(let i = 0; i  < 9; i++) {
            result.push(Number(await reqHandler.get({ url: `url${i}`})));
            // await new Promise((res) => setTimeout(() => res(), 100));
        }
        expect(fetch).toHaveBeenCalledTimes(9);
        expect(result.length).toEqual(9);
        expect(policeRateLim(result, 3, 1000)).toEqual(true);

    });

    test('Consecutive errors get retried with exponential backoff 3 times', async () => {
        mockedFetch.mockImplementation(() => {
            throw new Error('error');
        });

        const reqHandler = new RequestHandler(3, 400);
        const result: number[] = [];
        let error;
        const timeA = Date.now();
        try{
            result.push(Number(await reqHandler.get({ url: `url`})));
        } catch(e) {
            error = e;
        }
        const delta = Date.now() - timeA;
        expect(delta).toBeLessThan(2900);
        expect(delta).toBeGreaterThan(2700)
        expect(error).toBeTruthy();
        expect(fetch).toHaveBeenCalledTimes(4);
        expect(result.length).toEqual(0);
    });
});