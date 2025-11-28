// src/instrumentations/fetch.ts
import * as api from "@opentelemetry/api";
import { SugaredTracer } from "@opentelemetry/api/experimental";
import { _globalThis } from "@opentelemetry/core";
var FetchInstrumentation = class {
  constructor(config = {}) {
    this.instrumentationName = "@netlify/otel/instrumentation-fetch";
    this.instrumentationVersion = "1.0.0";
    this.originalFetch = null;
    this.config = config;
  }
  getConfig() {
    return this.config;
  }
  setConfig() {
  }
  setMeterProvider() {
  }
  setTracerProvider(provider) {
    this.provider = provider;
  }
  getTracerProvider() {
    return this.provider;
  }
  annotateFromRequest(span, request) {
    const extras = this.config.getRequestAttributes?.(request) ?? {};
    const url = new URL(request.url);
    span.setAttributes({
      ...extras,
      "http.request.method": request.method,
      "url.full": url.href,
      "url.host": url.host,
      "url.scheme": url.protocol.slice(0, -1),
      "server.address": url.hostname,
      "server.port": url.port,
      ...this.prepareHeaders("request", request.headers)
    });
  }
  annotateFromResponse(span, response) {
    const extras = this.config.getResponseAttributes?.(response) ?? {};
    span.setAttributes({
      ...extras,
      "http.response.status_code": response.status,
      ...this.prepareHeaders("response", response.headers)
    });
    span.setStatus({ code: response.status >= 400 ? api.SpanStatusCode.ERROR : api.SpanStatusCode.UNSET });
  }
  prepareHeaders(type, headers) {
    if (this.config.skipHeaders === true) {
      return {};
    }
    const everything = ["*", "/.*/"];
    const skips = this.config.skipHeaders ?? [];
    const redacts = this.config.redactHeaders ?? [];
    const everythingSkipped = skips.some((skip) => everything.includes(skip.toString()));
    const attributes = {};
    if (everythingSkipped) return attributes;
    const entries = headers.entries();
    for (const [key, value] of entries) {
      if (skips.some((skip) => typeof skip == "string" ? skip == key : skip.test(key))) {
        continue;
      }
      const attributeKey = `http.${type}.header.${key}`;
      if (redacts === true || redacts.some((redact) => typeof redact == "string" ? redact == key : redact.test(key))) {
        attributes[attributeKey] = "REDACTED";
      } else {
        attributes[attributeKey] = value;
      }
    }
    return attributes;
  }
  getTracer() {
    if (!this.provider) {
      return void 0;
    }
    const tracer = this.provider.getTracer(this.instrumentationName, this.instrumentationVersion);
    if (tracer instanceof SugaredTracer) {
      return tracer;
    }
    return new SugaredTracer(tracer);
  }
  /**
   * patch global fetch
   */
  enable() {
    const originalFetch = _globalThis.fetch;
    this.originalFetch = originalFetch;
    _globalThis.fetch = async (resource, options) => {
      const url = typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url;
      const tracer = this.getTracer();
      if (!tracer || this.config.skipURLs?.some((skip) => typeof skip == "string" ? url.startsWith(skip) : skip.test(url))) {
        return await originalFetch(resource, options);
      }
      return tracer.withActiveSpan("fetch", async (span) => {
        const request = new Request(resource, options);
        this.annotateFromRequest(span, request);
        const response = await originalFetch(request, options);
        this.annotateFromResponse(span, response);
        return response;
      });
    };
  }
  /**
   * unpatch global fetch
   */
  disable() {
    if (this.originalFetch) {
      _globalThis.fetch = this.originalFetch;
      this.originalFetch = null;
    }
  }
};
export {
  FetchInstrumentation
};
