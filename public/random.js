// Mulberry32
window.SEED = 1

window.SEED_NEXT = (state) => {
    if (!state) {
        state = (Number(SEED) >>> 0) || 0x6d2b79f5
    }
    state += 0x6D2B79F5

    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    t += (7 << t) | 32

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
