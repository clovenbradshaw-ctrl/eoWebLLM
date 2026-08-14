"use client";

import log from "loglevel";
import { createContext } from "react";
import {
  InitProgressReport,
  prebuiltAppConfig,
  ChatCompletionMessageParam,
  ServiceWorkerMLCEngine,
  ChatCompletionChunk,
  ChatCompletion,
  WebWorkerMLCEngine,
  CompletionUsage,
  ChatCompletionFinishReason,
} from "@mlc-ai/web-llm";

import { ChatOptions, LLMApi, LLMConfig, RequestMessage } from "./api";
import { LogLevel } from "@mlc-ai/web-llm";
import { fixMessage } from "../utils";
import { DEFAULT_MODELS } from "../constant";
import { CacheType, useAppConfig } from "../store/config";

const KEEP_ALIVE_INTERVAL = 5_000;

type ServiceWorkerWebLLMHandler = {
  type: "serviceWorker";
  engine: ServiceWorkerMLCEngine;
};

type WebWorkerWebLLMHandler = {
  type: "webWorker";
  engine: WebWorkerMLCEngine;
};

type WebLLMHandler = ServiceWorkerWebLLMHandler | WebWorkerWebLLMHandler;

export class WebLLMApi implements LLMApi {
  private llmConfig?: LLMConfig;
  private initialized = false;
  private initializing?: Promise<void>;
  webllm: WebLLMHandler;

  // Monotonic progress across the download + load phases of a single model
  // reload: reported progress is never allowed to go backwards, so the UI
  // shows one continuous bar instead of resetting between phases.
  private lastProgress = 0;
  private progressText = "";

  /** Current download/load progress, monotonic within a single reload. */
  get currentProgress() {
    return { progress: this.lastProgress, text: this.progressText };
  }

  constructor(
    type: "serviceWorker" | "webWorker",
    logLevel: LogLevel = "WARN",
  ) {
    const engineConfig = {
      appConfig: {
        ...prebuiltAppConfig,
        cacheBackend:
          useAppConfig.getState().cacheType === CacheType.IndexDB
            ? ("indexeddb" as const)
            : ("cache" as const),
      },
      logLevel,
    };

    if (type === "serviceWorker") {
      log.info("Create ServiceWorkerMLCEngine");
      this.webllm = {
        type: "serviceWorker",
        engine: new ServiceWorkerMLCEngine(engineConfig, KEEP_ALIVE_INTERVAL),
      };
    } else {
      log.info("Create WebWorkerMLCEngine");
      this.webllm = {
        type: "webWorker",
        engine: new WebWorkerMLCEngine(
          new Worker(new URL("../worker/web-worker.ts", import.meta.url), {
            type: "module",
          }),
          engineConfig,
        ),
      };
    }
  }

  private async initModel(
    onProgress?: (progress: number, text: string) => void,
  ) {
    if (!this.llmConfig) {
      throw Error("llmConfig is undefined");
    }
    if (!this.initializing) {
      // A fresh reload means a fresh download/load run — reset the monotonic
      // floor so a model switch shows real progress again.
      this.lastProgress = 0;
      this.progressText = "";
      this.initializing = (async () => {
        this.webllm.engine.setInitProgressCallback(
          (report: InitProgressReport) => {
            this.lastProgress = Math.max(this.lastProgress, report.progress);
            if (report.text) this.progressText = report.text;
            onProgress?.(this.lastProgress, this.progressText);
          },
        );
        await this.webllm.engine.reload(this.llmConfig!.model, this.llmConfig!);
        this.initialized = true;
      })().finally(() => {
        this.initializing = undefined;
      });
    }
    await this.initializing;
  }

  /** Download/compile the selected model before the reader sends a turn. */
  async preload(
    config: LLMConfig,
    onProgress?: (progress: number, text: string) => void,
  ): Promise<void> {
    if (!this.initialized || this.isDifferentConfig(config)) {
      this.llmConfig = { ...(this.llmConfig || {}), ...config };
      await this.initModel(onProgress);
    }
  }

  async chat(options: ChatOptions): Promise<void> {
    if (!this.initialized || this.isDifferentConfig(options.config)) {
      this.llmConfig = { ...(this.llmConfig || {}), ...options.config };
      // Check if this is a Qwen3 model with thinking mode enabled
      const isQwen3Model = this.llmConfig?.model
        ?.toLowerCase()
        .startsWith("qwen3");
      const isThinkingEnabled = this.llmConfig?.enable_thinking === true;

      // Apply special config for Qwen3 models with thinking mode enabled
      if (isQwen3Model && isThinkingEnabled && this.llmConfig) {
        this.llmConfig = {
          ...this.llmConfig,
          temperature: 0.6,
          top_p: 0.95,
        };
      }
      try {
        await this.initModel(options.onProgress);
      } catch (err: any) {
        let errorMessage = err.message || err.toString() || "";
        if (errorMessage === "[object Object]") {
          errorMessage = JSON.stringify(err);
        }
        console.error("Error while initializing the model", errorMessage);
        options?.onError?.(errorMessage);
        return;
      }
    }

    let reply: string | null = "";
    let stopReason: ChatCompletionFinishReason | undefined;
    let usage: CompletionUsage | undefined;
    try {
      const completion = await this.chatCompletion(
        !!options.config.stream,
        options.messages,
        options.onUpdate,
      );
      reply = completion.content;
      stopReason = completion.stopReason;
      usage = completion.usage;
    } catch (err: any) {
      let errorMessage = err.message || err.toString() || "";
      if (errorMessage === "[object Object]") {
        log.error(JSON.stringify(err));
        errorMessage = JSON.stringify(err);
      }
      console.error("Error in chatCompletion", errorMessage);
      if (
        errorMessage.includes("WebGPU") &&
        errorMessage.includes("compatibility chart")
      ) {
        // Add WebGPU compatibility chart link
        errorMessage = errorMessage.replace(
          "compatibility chart",
          "[compatibility chart](https://caniuse.com/webgpu)",
        );
      }
      options.onError?.(errorMessage);
      return;
    }

    if (reply) {
      reply = fixMessage(reply);
      try {
        options.onFinish(reply, stopReason, usage);
      } catch (err: any) {
        // onFinish (the store's post-generation pass — grounding spans,
        // citation building, etc.) runs with no safety net of its own; a
        // throw anywhere in there used to escape uncaught right past the
        // isGenerating=false reset that same handler is responsible for,
        // permanently wedging the session so every later send just queues
        // forever (chat.tsx's onSubmit keeps deferring to
        // session.isGenerating, which never clears). Routing the failure
        // to onError instead guarantees the caller's own isGenerating=false
        // + flushQueuedInput cleanup still runs.
        console.error("Error in onFinish handler", err);
        options.onError?.(err);
      }
    } else {
      options.onError?.(new Error("Empty response generated by LLM"));
    }
  }

  async abort() {
    await this.webllm.engine?.interruptGenerate();
  }

  private isDifferentConfig(config: LLMConfig): boolean {
    if (!this.llmConfig) {
      return true;
    }

    // Compare required fields
    if (this.llmConfig.model !== config.model) {
      return true;
    }

    // Compare optional fields
    const optionalFields: (keyof LLMConfig)[] = [
      "temperature",
      "context_window_size",
      "top_p",
      "stream",
      "presence_penalty",
      "frequency_penalty",
      "enable_thinking",
    ];

    for (const field of optionalFields) {
      if (
        this.llmConfig[field] !== undefined &&
        config[field] !== undefined &&
        this.llmConfig[field] !== config[field]
      ) {
        return true;
      }
    }

    return false;
  }

  async chatCompletion(
    stream: boolean,
    messages: RequestMessage[],
    onUpdate?: (
      message: string,
      chunk: string,
      usage?: CompletionUsage,
    ) => void,
  ) {
    // For Qwen3 models, we need to filter out the <think>...</think> content
    // Do not do it inplace, create a new messages array
    let newMessages: RequestMessage[] | undefined;
    const isQwen3Model = this.llmConfig?.model
      ?.toLowerCase()
      .startsWith("qwen3");
    if (isQwen3Model) {
      newMessages = messages.map((message) => {
        const newMessage = { ...message };
        if (
          message.role === "assistant" &&
          typeof message.content === "string"
        ) {
          newMessage.content = message.content.replace(
            /^<think>[\s\S]*?<\/think>\n?\n?/,
            "",
          );
        }
        return newMessage;
      });
    }

    // Prepare extra_body with enable_thinking option for Qwen3 models
    const extraBody: Record<string, any> = {};
    if (isQwen3Model) {
      extraBody.enable_thinking = this.llmConfig?.enable_thinking ?? false;
    }

    const completion = await this.webllm.engine.chatCompletion({
      stream: stream,
      messages: (newMessages || messages) as ChatCompletionMessageParam[],
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(Object.keys(extraBody).length > 0 ? { extra_body: extraBody } : {}),
    });

    if (stream) {
      let content: string | null = "";
      let stopReason: ChatCompletionFinishReason | undefined;
      let usage: CompletionUsage | undefined;
      const asyncGenerator = completion as AsyncIterable<ChatCompletionChunk>;
      for await (const chunk of asyncGenerator) {
        if (chunk.choices[0]?.delta.content) {
          content += chunk.choices[0].delta.content;
          onUpdate?.(content, chunk.choices[0].delta.content);
        }
        if (chunk.usage) {
          usage = chunk.usage;
        }
        if (chunk.choices[0]?.finish_reason) {
          stopReason = chunk.choices[0].finish_reason;
        }
      }
      return { content, stopReason, usage };
    }

    const chatCompletion = completion as ChatCompletion;
    return {
      content: chatCompletion.choices[0].message.content,
      stopReason: chatCompletion.choices[0].finish_reason,
      usage: chatCompletion.usage,
    };
  }

  async models() {
    return DEFAULT_MODELS;
  }
}
