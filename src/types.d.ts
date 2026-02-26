export interface IElectron {
    on: (channel: string, func: (...args: any[]) => void) => void;
    off: (channel: string, func: (...args: any[]) => void) => void;
    send: (channel: string, ...args: any[]) => void;
    invoke: (channel: string, ...args: any[]) => Promise<any>;
}

export interface IClipboardAPI {
    readText: () => string;
}

declare global {
    interface Window {
        ipcRenderer: IElectron;
        clipboardAPI: IClipboardAPI;
    }
}
