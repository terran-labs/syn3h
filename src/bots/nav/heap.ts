/**
 * Binary min heap of grid node indices keyed by a float, on typed arrays so a search does
 * not allocate per push. Ties pop in a fixed order (the order the sift rules leave them),
 * which keeps routes deterministic for identical inputs.
 */
export class NodeHeap {
  private nodes = new Int32Array(1024)
  private keys = new Float64Array(1024)
  size = 0

  clear(): void {
    this.size = 0
  }

  push(node: number, key: number): void {
    if (this.size === this.nodes.length) {
      const nodes = new Int32Array(this.size * 2)
      const keys = new Float64Array(this.size * 2)
      nodes.set(this.nodes)
      keys.set(this.keys)
      this.nodes = nodes
      this.keys = keys
    }
    let i = this.size++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.keys[parent] <= key) break
      this.nodes[i] = this.nodes[parent]
      this.keys[i] = this.keys[parent]
      i = parent
    }
    this.nodes[i] = node
    this.keys[i] = key
  }

  /** Remove and return the node with the smallest key. Call only when size > 0. */
  pop(): number {
    const top = this.nodes[0]
    const n = --this.size
    if (n > 0) {
      const node = this.nodes[n]
      const key = this.keys[n]
      let i = 0
      for (;;) {
        let child = i * 2 + 1
        if (child >= n) break
        if (child + 1 < n && this.keys[child + 1] < this.keys[child]) child++
        if (this.keys[child] >= key) break
        this.nodes[i] = this.nodes[child]
        this.keys[i] = this.keys[child]
        i = child
      }
      this.nodes[i] = node
      this.keys[i] = key
    }
    return top
  }
}
