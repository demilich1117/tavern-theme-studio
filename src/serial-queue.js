// Keep a failed operation from poisoning later writes. Committers read the latest
// in-memory state inside the queue, not before awaiting network or disk work.
export function serialQueue() {
  let tail = Promise.resolve();
  return work => {
    const task = tail.then(work);
    tail = task.catch(() => {});
    return task;
  };
}
