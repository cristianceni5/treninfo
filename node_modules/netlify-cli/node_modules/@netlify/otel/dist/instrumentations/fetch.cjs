"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/instrumentations/fetch.ts
var fetch_exports = {};
__export(fetch_exports, {
  FetchInstrumentation: () => FetchInstrumentation
});
module.exports = __toCommonJS(fetch_exports);
var api = __toESM(require("@opentelemetry/api"), 1);
var import_experimental = require("@opentelemetry/api/experimental");
var import_core = require("@opentelemetry/core");
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
    if (tracer instanceof import_experimental.SugaredTracer) {
      return tracer;
    }
    return new import_experimental.SugaredTracer(tracer);
  }
  /**
   * patch global fetch
   */
  enable() {
    const originalFetch = import_core._globalThis.fetch;
    this.originalFetch = originalFetch;
    import_core._globalThis.fetch = async (resource, options) => {
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
      import_core._globalThis.fetch = this.originalFetch;
      this.originalFetch = null;
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FetchInstrumentation
});
