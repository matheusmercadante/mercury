// WHICH OF THE ORIGINAL TEAM'S HOSTED SERVICES THIS COPY FALLS BACK TO.
// This fork is one person's. A switch that is off stops the address shipped
// in the code from being used; an address you configure yourself still is.
// Nothing behind a switch is deleted: set it to true to bring the service back.
export const HOSTED_SERVICES = Object.freeze({
  // Agentbox Cloud (CLOUD_ADDRESS): its sign-in, runs on its server, and a
  // release baking it in (main/cloud/config.mjs cloudAccountConfig).
  cloud: false,
  // The Feedback card's server function (FEEDBACK_ADDRESS in main/feedback.mts).
  feedback: false,
});
