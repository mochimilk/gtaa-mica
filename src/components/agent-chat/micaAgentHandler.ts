import type { AgentHandler, ChatChunk } from "@coral-ai/chat";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The chat's agent: each message goes to the same executor as a voice
 * request (see `LiveCallValue.runTypedRequest`), so Skye can act on the board
 * from the chat too, and its reply is streamed back word by word.
 *
 * @param run Runs one typed request; resolves with the reply, or null when a
 *   newer request replaced it before it finished.
 */
export function createMicaAgentHandler(run: (text: string) => Promise<string | null>): AgentHandler {
  return async function* micaAgentHandler(input: string): AsyncIterable<ChatChunk> {
    const reply = (await run(input.trim())) ?? "I set that aside for your newer request.";
    for (const word of reply.split(/(?<= )/)) {
      yield word;
      await wait(18);
    }
  };
}
