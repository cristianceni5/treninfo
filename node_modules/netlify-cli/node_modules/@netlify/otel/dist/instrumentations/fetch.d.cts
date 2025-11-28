import * as api from '@opentelemetry/api';
import { InstrumentationConfig, Instrumentation } from '@opentelemetry/instrumentation';

interface FetchInstrumentationConfig extends InstrumentationConfig {
    getRequestAttributes?(headers: Request): api.Attributes;
    getResponseAttributes?(response: Response): api.Attributes;
    skipURLs?: (string | RegExp)[];
    skipHeaders?: (string | RegExp)[] | true;
    redactHeaders?: (string | RegExp)[] | true;
}
declare class FetchInstrumentation implements Instrumentation {
    instrumentationName: string;
    instrumentationVersion: string;
    private originalFetch;
    private config;
    private provider?;
    constructor(config?: FetchInstrumentationConfig);
    getConfig(): FetchInstrumentationConfig;
    setConfig(): void;
    setMeterProvider(): void;
    setTracerProvider(provider: api.TracerProvider): void;
    getTracerProvider(): api.TracerProvider | undefined;
    private annotateFromRequest;
    private annotateFromResponse;
    private prepareHeaders;
    private getTracer;
    /**
     * patch global fetch
     */
    enable(): void;
    /**
     * unpatch global fetch
     */
    disable(): void;
}

export { FetchInstrumentation, type FetchInstrumentationConfig };
