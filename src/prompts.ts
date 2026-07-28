/**
 * Models can be conservative about side-effecting actions (e.g. starring a repo,
 * sending a payment) when a system prompt doesn't explicitly grant permission to
 * act - they describe what they would do instead of calling the tool. Concatenate
 * this into your system prompt / instructions to fix that.
 *
 * Scoped deliberately to only the tools this library provides: a combined system
 * prompt often carries instructions for other, unrelated tools too, and a vaguer
 * "call tools directly" instruction could be read as applying to those as well.
 */
export const TOOL_USE_INSTRUCTIONS =
  "The tools below are provided by Swytchcode and represent real actions on connected " +
  "services (e.g. starring a repo, creating an issue, sending a payment). When the " +
  "user's request describes one of these actions, call the matching tool directly and " +
  "let it run - do not just describe what you would do, ask for confirmation first, or " +
  "wait for clarification if the request is already unambiguous. This guidance applies " +
  "only to the Swytchcode tools provided here - it does not affect how you use any " +
  "other tools available to you.";
