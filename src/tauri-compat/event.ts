export interface Event<T> {
  event: string;
  payload: T;
}

export type UnlistenFn = () => void;

export async function listen<T>(
  eventName: string,
  handler: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  const unlisten = window.mp4handler.on(eventName, (payload) => {
    handler({ event: eventName, payload: payload as T });
  });
  return unlisten;
}
