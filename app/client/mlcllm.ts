import log from "loglevel";
import { ChatOptions, LLMApi } from "./api";
import {
  ChatCompletionFinishReason,
  CompletionUsage,
  ChatCompletion,
} from "@mlc-ai/web-llm";

export class MlcLLMApi implements LLMApi {
  private endpoint: string;
  private abortController: AbortController | null = null;

  // Same structural backstop as app/client/webllm.ts's engineQueue — see
  // that field's own comment for the full rationale (a caller that doesn't
  // coordinate through app/store/chat.ts's eoEngineBusy mutex, like the
  // /coding route, can otherwise fire a second real request while one is
  // in flight). This backend has a second, narrower reason to serialize
  // too: `abortController` below is a single shared field, reassigned on
  // every call — two calls in flight at once means the second call's
  // chat() silently points a later abort() at the wrong request.
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  async chat(options: ChatOptions): Promise<void> {
    const previous = this.requestQueue;
    let releaseNext: (() => void) | undefined;
    this.requestQueue = new Promise<void>((resolve) => {
      releaseNext = resolve;
    });
    await previous;
    try {
      await this.dispatchChat(options);
    } finally {
      releaseNext?.();
    }
  }

  private async dispatchChat(options: ChatOptions) {
    const { messages, config } = options;

    const payload = {
      messages: messages,
      ...config,
    };

    // Instantiate a new AbortController for this request
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    let reply: string = "";
    let stopReason: ChatCompletionFinishReason | undefined;
    let usage: CompletionUsage | undefined;

    try {
      const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal,
      });

      if (config.stream) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder("utf-8");
        let pending = "";
        let done = false;
        while (true) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;

          // SSE transports are allowed to split an event across reads or
          // batch several events into one read. Ollama does both in normal
          // streaming, so parsing one greedy `data:` match can leave a turn
          // permanently in its optimistic "Typing…" state. Keep an event
          // buffer and consume every complete line independently.
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const event = line.slice(5).trim();
            if (event === "[DONE]") {
              done = true;
              break;
            }
            try {
              const data = JSON.parse(event);
              if (data.choices && data.choices.length > 0) {
                const delta = data.choices[0].delta.content ?? "";
                if (delta) {
                  reply += delta;
                  options.onUpdate?.(reply, delta);
                }

                if (data.choices[0].finish_reason) {
                  stopReason = data.choices[0].finish_reason;
                }

                if (data.usage) {
                  usage = data.usage;
                }
              }
            } catch (e) {
              log.error(
                "Error parsing streaming response from MLC-LLM server",
                e,
              );
            }
          }
          if (done) break;
        }
        options.onFinish(reply, stopReason, usage);
      } else {
        const data = await response.json();
        options.onFinish(
          data.choices[0].message.content,
          data.choices[0].finish_reason || undefined,
          data.usage || undefined,
        );
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        log.info("MLC_LLM: chat aborted");
      } else {
        log.error("MLC_LLM: Fetch error:", error);
        options.onError?.(error);
      }
    }
  }

  // Implements the abort method to cancel the request
  async abort() {
    this.abortController?.abort();
  }

  async models() {
    try {
      const response = await fetch(`${this.endpoint}/v1/models`, {
        method: "GET",
      });
      const jsonRes = await response.json();
      return jsonRes.data.map((model: { id: string }) => ({
        name: model.id,
        display_name: model.id.split("/")[model.id.split("/").length - 1],
      }));
    } catch (error: any) {
      log.error("MLC_LLM: Fetch error:", error);
    }
  }
}
