import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createGoogleOcrClient, GOOGLE_OCR_INFO_TYPES, readGoogleConfig, secureJsonPost } from "./google-secure-api.mjs";

test("kun regionale EU-endpoints konfigureres", () => {
  const config = readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks", GOOGLE_VISION_LOCATION: "eu", GOOGLE_DLP_LOCATION: "eu" });
  assert.equal(config.visionEndpoint, "https://eu-vision.googleapis.com");
  assert.equal(config.dlpEndpoint, "https://dlp.eu.rep.googleapis.com");
  assert.throws(() => readGoogleConfig({ GOOGLE_CLOUD_PROJECT: "dfks", GOOGLE_VISION_LOCATION: "global" }));
  assert.equal(GOOGLE_OCR_INFO_TYPES.includes("PERSON_NAME"), false);
});

test("globale og asynkrone endpoints afvises før netværkskald", async () => {
  let called = false;
  await assert.rejects(() => secureJsonPost("https://vision.googleapis.com/v1/files:asyncBatchAnnotate", "token", {}, {
    requestImpl() { called = true; },
  }), /google_endpoint_rejected/);
  assert.equal(called, false);
});

test("DLP-fejl stopper siden før Vision", async () => {
  let visionCalled = false;
  const client = createGoogleOcrClient({
    config: {
      projectId: "dfks", visionLocation: "eu", dlpLocation: "eu",
      visionEndpoint: "https://eu-vision.googleapis.com", dlpEndpoint: "https://dlp.eu.rep.googleapis.com",
    },
    accessTokenProvider: async () => "short-lived",
    jsonPost: async (url) => {
      if (url.includes("content:inspect")) throw new Error("dlp_unavailable");
      visionCalled = true;
      return { responses: [] };
    },
  });
  await assert.rejects(() => client.redactAndAnnotate([{ pageNumber: 1, imageBytes: Buffer.from("jpeg") }]), /dlp_unavailable/);
  assert.equal(visionCalled, false);
});

test("Google-kald kræver TLS 1.3", async () => {
  let options;
  const requestImpl = (received, callback) => {
    options = received;
    const request = new EventEmitter();
    const socket = new EventEmitter();
    socket.getProtocol = () => "TLSv1.3";
    const response = new EventEmitter();
    response.statusCode = 200;
    request.end = () => {
      request.emit("socket", socket);
      socket.emit("secureConnect");
      callback(response);
      response.emit("data", Buffer.from("{}"));
      response.emit("end");
    };
    request.destroy = (error) => request.emit("error", error);
    return request;
  };
  await secureJsonPost("https://eu-vision.googleapis.com/v1/images:annotate", "short-lived", {}, { requestImpl });
  assert.equal(options.minVersion, "TLSv1.3");
  assert.equal(options.rejectUnauthorized, true);
});
