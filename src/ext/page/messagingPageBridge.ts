import browser from "webextension-polyfill";
import { PageBridge, FormReadout } from "../../core/page/pageBridge";

async function sendMessage<T>(tabId: number, action: string, args: unknown[]): Promise<T> {
  return (await browser.tabs.sendMessage(tabId, { action, args })) as T;
}

export class MessagingPageBridge implements PageBridge {
  constructor(
    private readonly tabId: number,
    private readonly domain: string,
  ) {}

  async readForm(): Promise<FormReadout> {
    return sendMessage<FormReadout>(this.tabId, "readForm", []);
  }

  async fill(elementId: string, value: string): Promise<void> {
    await sendMessage(this.tabId, "fill", [elementId, value]);
  }

  async setChecked(elementId: string, checked: boolean): Promise<void> {
    await sendMessage(this.tabId, "setChecked", [elementId, checked]);
  }

  async highlight(elementId: string, color: string): Promise<void> {
    await sendMessage(this.tabId, "highlight", [elementId, color]);
  }

  async clickSubmit(elementId: string): Promise<void> {
    await sendMessage(this.tabId, "clickSubmit", [elementId]);
  }

  currentDomain(): string {
    return this.domain;
  }
}
