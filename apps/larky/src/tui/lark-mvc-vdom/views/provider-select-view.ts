import { z } from "zod";
import { defineTerminalView, tuiUseStore, tuiUseEffect } from "../runtime/view-ctx.js";
import { intArg } from "@/utils/index.js";
import { Text } from "../components/text.js";
import { Box } from "../components/box.js";
import { createDialogStore, renderCursor } from "../stores/dialog-store.js";
import { COLORS, ICONS } from "../utils/styles.js";
import { keyboard } from "../runtime/keyboard-input.js";

const ProviderSchema = z.object({
  name: z.string(),
  protocol: z.string(),
  model: z.string(),
});

type Provider = z.infer<typeof ProviderSchema>;

const ProviderArraySchema = z.array(ProviderSchema);

const OnSelectCallbackSchema = z.custom<(provider: Provider) => void>(
  (v): v is (provider: Provider) => void => typeof v === "function",
);

function noopOnSelect(_provider: Provider): void {
  // intentionally empty
}

export const ProviderSelectView = defineTerminalView((_ctx, props?: Record<string, unknown>) => {
  const rawProviders = props?.providers;
  const providersResult = ProviderArraySchema.safeParse(rawProviders);
  const providers: Provider[] = providersResult.success ? providersResult.data : [];

  const rawOnSelect = props?.onSelect;
  const onSelectResult = OnSelectCallbackSchema.safeParse(rawOnSelect);
  const onSelect: (provider: Provider) => void = onSelectResult.success
    ? onSelectResult.data
    : noopOnSelect;

  const store = createDialogStore(providers.length);

  tuiUseStore(store, (s) => ({
    cursor: s.cursor,
    isSubmitted: s.isSubmitted,
  }));

  tuiUseEffect(() => {
    const off = keyboard.on((_input, key) => {
      if (key.upArrow) {
        store.setState({ cursor: Math.max(0, store.getState().cursor - 1) });
      } else if (key.downArrow) {
        store.setState({ cursor: Math.min(providers.length - 1, store.getState().cursor + 1) });
      } else if (key.return) {
        const state = store.getState();
        onSelect(providers[state.cursor]);
      }
    });
    return off;
  }, []);

  return (data) => {
    const cursor = intArg(data, "cursor", 0);

    const children = providers.map((p) => {
      return Box({
        id: p.name,
        children: [
          Text({
            children: [
              renderCursor(p === providers[cursor]),
              p === providers[cursor] ? COLORS.white(p.name) : p.name,
              Text({ dimColor: true, children: ` (${p.protocol} ${ICONS.arrow} ${p.model})` }),
            ],
          }),
        ],
      });
    });

    return Box({
      paddingLeft: 1,
      paddingTop: 1,
      children: [
        Text({ bold: true, children: COLORS.primary("Select a provider:") }),
        Text({ dimColor: true, children: " " }),
        ...children,
        Text({ dimColor: true, children: "\n  ↑/↓ to navigate, Enter to select" }),
      ],
    });
  };
});
