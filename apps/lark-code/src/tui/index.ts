// TUI entry point: renders the main App component with Ink
import React from "react";
import { render } from "ink";

import { App } from "./app.js";
import { getConfig } from "../core/config.js";
import { SocketClient } from "../core/transport/socket-client.js";

export async function launchTUI(): Promise<void> {
  const config = getConfig();
  const client = new SocketClient(config.host, config.port);

  try {
    const instance = render(React.createElement(App, { _config: config, client }), {
      exitOnCtrlC: false,
    });

    // Wait for the app to exit
    await instance.waitUntilExit();
  } catch (error) {
    console.error("Failed to launch TUI:", error);
    process.exit(1);
  }
}
