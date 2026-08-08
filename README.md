<div align="center">

# eoWebLLM

<a href="https://github.com/mlc-ai/web-llm"><img alt="Related Repository: WebLLM" src="https://img.shields.io/badge/Related_Repo-WebLLM-fafbfc?logo=github"></a>
<a href="https://chat.webllm.ai"><img alt="Web App Deployed on GitHub Pages" src="https://img.shields.io/badge/Web_App-Deployed-32a852?logo=pwa"></a>
<a href="https://discord.gg/9Xpy2HGBuD"><img alt="Join Discord" src="https://img.shields.io/badge/Join-Discord-7289DA?logo=discord&logoColor=white"></a>

**Private AI Conversations, Fully In-Browser.**

[**Chat Now**](https://chat.webllm.ai/)

[WebLLM Chat Demo Video](https://github.com/mlc-ai/web-llm-chat/assets/23090573/f700e27e-bb88-4068-bc8b-8a33ea5a4300)

</div>

## eochat intelligence (bounded context)

**eoWebLLM** is a fork of [mlc-ai/web-llm-chat](https://github.com/mlc-ai/web-llm-chat) that ports the conversational engine of [clovenbradshaw-ctrl/eochat](https://github.com/clovenbradshaw-ctrl/eochat) so the context window **never grows**:

- **surf** — an instruction gate surfaces the rules in force for each turn from eochat's `instruction-set` (see `app/client/eo-gate.ts` and `app/client/eo-instructions.ts`); folded folds stay named in an audit index instead of being dropped.
- **fold** — every completed turn is folded to its discourse contribution and rolled into a running **PAST DISCOURSE** summary (`app/client/eo-discourse.ts`).
- **prompt** — the model is prompted with the gate block + summary + a bounded recency window; raw history is never resent past a fixed ceiling.

## Warrant: when grounding fires

Bounding the context window means most of what bears on a turn is *folded* —
held back — at any moment. That makes one question decidable that "is this a
hard question?" never was: **where would the warrant for this answer have to
come from?** `app/client/eo-warrant.ts` answers it from the fold ledger, with
no model call, before a token is generated.

Each channel carries a different kind of warrant:

| channel | can carry a claim | why |
| --- | --- | --- |
| `corpus` · `web` · `file` | yes, and it is checked | bytes that exist outside the model and can be re-read |
| `desk` | yes, for what was said | the verbatim record of stated facts |
| `discourse` | **no** | a paraphrase whose source is no longer in the prompt |
| `rules` | no | they govern form, they never supply a fact |
| `internal` | yes, when nothing external bore on the turn | must be said to be general knowledge |

Grounding fires whenever external material bears on the turn, whenever material
was folded away or crowded out, and whenever provenance cannot be established —
unknown warrant is treated as missing warrant. A search that ran and came back
empty fires it too: that is the one check that could have confirmed the answer,
and it didn't.

**System 1 / System 2** (Kahneman) is not a speed setting; the two do different
work.

- *Surf.* System 1 scores the instruction gate and the corpus lexically against
  the question — availability-biased, one pass, budget-capped. System 2 scores
  against the **claims the draft actually made**, searches contrastively for
  defeaters, re-reads each hit in a wider byte window, and un-folds the rules
  that matched this turn and lost the budget race.
- *Fold.* System 1 keeps a ~100-character gist. System 2 keeps an **address** —
  the byte ranges and URLs the answer was checked against, what failed, what
  stayed open — so a System 2 fold can be re-opened where a System 1 fold can
  only be recalled.
- *Responses.* A turn is a response set, not a message. The first streamed
  message is the System 1 draft and is never blocked. System 2 may then speak
  again — a grounding note, a counter-reading, a worked-through result — each
  earned by a mechanical condition, capped and disclosed. **More than one
  response is System 2 by construction**: a turn only needs a second utterance
  because it found something the first could not hold.

Escalation is monotone. A model probe can raise a turn to System 2 and can
never lower it, so a slow or failed probe subtracts a second opinion and never
subtracts a check.

Run `yarn test` for the assay: it checks that grounding fires on every channel,
that fold pressure escalates, that unknown provenance fails toward grounding,
and that the System 2 surf can surface a rule the System 1 surf structurally
could not.

Sourced from:
- [clovenbradshaw-ctrl/eochat](https://github.com/clovenbradshaw-ctrl/eochat) — conversational engine (`server/instruction-gate.js`, `server/conversation-summary.js`, `instruction-set/`)
- [clovenbradshaw-ctrl/eo-constitution](https://github.com/clovenbradshaw-ctrl/eo-constitution) — constitutional rules backing the instruction set
- [clovenbradshaw-ctrl/eoreader6](https://github.com/clovenbradshaw-ctrl/eoreader6) — reading-engine role (kept separate; not ported here)

## Overview

**WebLLM Chat** is a private AI chat interface that combines [WebLLM](https://github.com/mlc-ai/web-llm) with a user-friendly design, leveraging WebGPU to run large language models (LLMs) natively in your browser. Enjoy an unprecedented, private, and accessible AI conversation experience.

## Key Features

- **Browser-Native AI**: Experience cutting-edge language models running natively within your web browser with WebGPU acceleration, eliminating the need for server-side processing or cloud dependencies.
- **Ganranteed Privacy**: With the AI model running locally on your hardware and all data processing happening within your browser, your data and conversations never leave your computer, ensuring your privacy.
- **Offline Accessibility**: Run entirely offline after the initial setup and download, allowing you to engage with AI-powered conversations without an active internet connection.
- **Vision Model Support**: Chat with AI by uploading and sending images, making it easy to get insights and answers based on visual content.
- **User-Friendly Interface**: Enjoy the intuitive and feature-rich user interface, complete with markdown support, dark mode, and a responsive design optimized for various screen sizes.
- **Custom Models**: Connect to any custom language model on you local environment through [MLC-LLM](https://llm.mlc.ai/). For detail, check the [Use Custom Models](#use-custom-models) section.
- **Open Source and Customizable**: Build and customize your own AI-powered applications with our open-source framework.

WebLLM Chat is a pioneering initiative that combines the robust backend capabilities of WebLLM with the user-friendly interface of NextChat. As a part of the broader MLC.ai family, this project contributes to our mission of democratizing AI technology by making powerful tools accessible directly to end-users. By integrating with NextChat, WebLLM Chat not only enhances the chatting experience but also broadens the scope for deployment of self-hosted and customizable language models.

## Built-in Models

WebLLM Chat natively supports WebLLM build-in models. You can find the full list [here](https://github.com/mlc-ai/web-llm?tab=readme-ov-file#built-in-models).

## Use Custom Models

WebLLM Chat supports custom language models through [MLC-LLM](https://llm.mlc.ai/). Follow the following steps to use custom models on your local environment:

1. (Optional) Compile the model into MLC format by following [the instructions](https://llm.mlc.ai/docs/compilation/convert_weights.html).

2. Host REST API through MLC-LLM by following [the instructions](https://llm.mlc.ai/docs/deploy/rest.html).

3. Go to [WebLLM Chat](https://chat.webllm.ai/), select "Settings" in the side bar, then select "MLC-LLM REST API (Advanced)" as "Model Type" and type the REST API endpoint URL from step 2.

## Development

```shell
# 1. install nodejs and yarn first
# 2. config local env vars in `.env.local`
# 3. run
yarn install
yarn dev
```

## Deployment

### Build

You can build the application as a Next.js build using `yarn build` or as a static site using `yarn export`. For more information, check [Next.js documentation](https://nextjs.org/docs/pages/building-your-application/deploying);

### Docker

```shell
docker build -t webllm_chat .
docker run -d -p 3000:3000 webllm_chat
```

You can start service behind a proxy:

```shell
docker build -t webllm_chat .
docker run -d -p 3000:3000 \
   -e PROXY_URL=http://localhost:7890 \
   webllm_chat
```

If your proxy needs password, use:

```shell
-e PROXY_URL="http://127.0.0.1:7890 user pass"
```

## Community and Contributions

WebLLM Chat thrives on community involvement. We are committed to fostering an inclusive and innovative community where developers and AI enthusiasts can collaborate, contribute, and push the boundaries of what's possible in AI technology. Join us on Discord to connect with fellow developers and contribute to the project.

## Acknowledgements

WebLLM Chat is a companion project of [WebLLM](https://github.com/mlc-ai/web-llm/) and it is built upon the remarkable work of [NextChat](https://github.com/ChatGPTNextWeb/ChatGPT-Next-Web). We extend our sincere gratitude to the developers and contributors of these projects for their invaluable efforts in advancing the field of browser-based AI and creating user-friendly chat interfaces.

Further more, this project is only possible thanks to the shoulders of open-source ecosystems that we stand on. We want to thank the Apache TVM community and developers of the TVM Unity effort. The open-source ML community members made these models publicly available. PyTorch and Hugging Face communities make these models accessible. We would like to thank the teams behind Vicuna, SentencePiece, LLaMA, Alpaca. We also would like to thank the WebAssembly, Emscripten, and WebGPU communities. Finally, thanks to Dawn and WebGPU developers.
