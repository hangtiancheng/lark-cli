import { getSettings, getCurrentProvider } from "../settings.js";
import type { SelectOption } from "../components/select-list.js";
import type { CommandContext } from "./command-handler.js";

export function handleProviderCommand(ctx: CommandContext): void {
  const s = getSettings();
  if (s.providers.length === 0) {
    ctx.showNotification("No providers configured in settings.json");
    return;
  }

  const options: SelectOption[] = s.providers.map((p) => ({
    label: p.name,
    value: p.name,
    description: p.baseUrl,
  }));

  ctx.showSelect("Select model provider", options, s.PROVIDER, (chosen) => {
    s.PROVIDER = chosen;
    s.env.BASE_URL = s.providers.find((p) => p.name === chosen)?.baseUrl ?? s.env.BASE_URL;
    ctx.showNotification(`Provider switched to: ${chosen}`);
  });
}

export function handleModelCommand(ctx: CommandContext): void {
  const s = getSettings();
  const provider = getCurrentProvider();
  if (!provider) {
    ctx.showNotification(`No provider found for: ${s.PROVIDER}`);
    return;
  }

  if (provider.models.length === 0) {
    ctx.showNotification(`No models configured for provider: ${provider.name}`);
    return;
  }

  const options: SelectOption[] = provider.models.map((m) => ({
    label: m,
    value: m,
  }));

  ctx.showSelect(`Select chat model (${provider.name})`, options, s.env.MODEL, (chosen) => {
    s.env.MODEL = chosen;
    ctx.showNotification(`Model switched to: ${chosen}`);
  });
}
