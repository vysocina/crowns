/*
 * Infinite Queens-style puzzle generator.
 *
 * Rules:
 *   1. Exactly one crown per row.
 *   2. Exactly one crown per column.
 *   3. Exactly one crown per color/region.
 *   4. Crowns cannot touch, including diagonally.
 *   5. Every color is one continuous 4-connected region.
 *
 * Board size: 4..20
 *
 * Usage:
 *
 *   const level = generateLevel(8, 12345);
 *
 *   console.log(level.grid);
 *
 *   // Example rendering:
 *   for (const row of level.grid) {
 *       console.log(
 *           row.map(cell =>
 *               cell.crown ? `[${cell.region}]` : ` ${cell.region} `
 *           ).join("")
 *       );
 *   }
 *
 * Browser:
 *   <script src="generator.js"></script>
 *   const level = generateLevel(8, 12345);
 *
 * Node:
 *   const { generateLevel } = require("./generator");
 */

// -----------------------------------------------------------------------------
// RNG
// -----------------------------------------------------------------------------

class RNG {
    constructor(seed = Date.now()) {
        // Convert arbitrary integer-ish seed into uint32.
        this.state = (Number(seed) >>> 0) || 0x6d2b79f5;
    }

    next() {
        // Mulberry32
        let t = this.state += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    int(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    chance(probability) {
        return this.next() < probability;
    }

    pick(array) {
        return array[Math.floor(this.next() * array.length)];
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
}


// -----------------------------------------------------------------------------
// Utility
// -----------------------------------------------------------------------------

function make2D(size, value) {
    return Array.from(
        { length: size },
        () => Array.from({ length: size }, () => value)
    );
}

function inside(size, r, c) {
    return r >= 0 && r < size && c >= 0 && c < size;
}

const ORTHOGONAL = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1]
];

const ALL_NEIGHBORS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
];


// -----------------------------------------------------------------------------
// Crown generation
// -----------------------------------------------------------------------------

/*
 * Generates exactly one crown per row and column.
 *
 * Crown positions are represented as:
 *
 *   crowns[row] = column
 *
 * Example:
 *
 *   [1, 3, 0, 2]
 *
 * means:
 *
 *   row 0 -> column 1
 *   row 1 -> column 3
 *   row 2 -> column 0
 *   row 3 -> column 2
 *
 * The only adjacency restriction is that crowns cannot be within
 * Chebyshev distance 1 of each other.
 */

function generateCrowns(size, rng) {
    const crowns = Array(size).fill(-1);
    const usedColumns = Array(size).fill(false);

    function backtrack(row) {
        if (row === size) {
            return true;
        }

        let candidates = [];

        for (let col = 0; col < size; col++) {
            if (usedColumns[col]) {
                continue;
            }

            // Crown above-left / above / above-right is forbidden.
            if (row > 0) {
                const previousCol = crowns[row - 1];

                if (Math.abs(previousCol - col) <= 1) {
                    continue;
                }
            }

            candidates.push(col);
        }

        rng.shuffle(candidates);

        /*
         * A little heuristic:
         * try columns that have fewer future possibilities first,
         * but retain randomness.
         */
        candidates.sort((a, b) => {
            const scoreA = futureColumnOptions(row + 1, a);
            const scoreB = futureColumnOptions(row + 1, b);

            return scoreA - scoreB + rng.next() * 2 - 1;
        });

        for (const col of candidates) {
            crowns[row] = col;
            usedColumns[col] = true;

            if (backtrack(row + 1)) {
                return true;
            }

            usedColumns[col] = false;
            crowns[row] = -1;
        }

        return false;
    }

    function futureColumnOptions(nextRow, previousCol) {
        if (nextRow >= size) {
            return 0;
        }

        let count = 0;

        for (let c = 0; c < size; c++) {
            if (!usedColumns[c] && Math.abs(c - previousCol) > 1) {
                count++;
            }
        }

        return count;
    }

    if (!backtrack(0)) {
        throw new Error(`Could not generate crowns for ${size}x${size}`);
    }

    return crowns;
}


// -----------------------------------------------------------------------------
// Region generation
// -----------------------------------------------------------------------------

/*
 * Each crown becomes the seed of one color.
 *
 * We then grow all colors simultaneously.
 *
 * Important property:
 *
 *     A region is only grown from a tile touching that region.
 *
 * Therefore a region can never become disconnected.
 *
 * The random directional bias makes regions look more like squiggly
 * territories instead of perfectly round Voronoi cells.
 */

function generateRegions(size, crowns, rng) {
    const grid = make2D(size, -1);

    const regions = [];

    for (let region = 0; region < size; region++) {
        const row = region;
        const col = crowns[row];

        grid[row][col] = region;

        regions.push({
            id: region,
            crown: { r: row, c: col },
            size: 1,

            // Direction of movement.
            dirR: rng.int(-1, 1),
            dirC: rng.int(-1, 1),

            frontier: []
        });
    }

    /*
     * Add initial frontier cells.
     */
    for (const region of regions) {
        updateFrontier(region);
    }

    let remaining = size * size - size;

    /*
     * We deliberately allow quite a lot of randomness here.
     * The resulting boards are later validated and rejected if necessary.
     */
    let safety = size * size * 100;

    while (remaining > 0 && safety-- > 0) {
        const availableRegions = regions.filter(
            region => region.frontier.length > 0
        );

        if (availableRegions.length === 0) {
            break;
        }

        /*
         * Prefer smaller regions so one region doesn't swallow
         * the entire board.
         */
        const region = chooseRegion(availableRegions, size, rng);

        const candidates = getFrontierCandidates(region);

        if (candidates.length === 0) {
            updateFrontier(region);
            continue;
        }

        const candidate = chooseExpansion(
            region,
            candidates,
            grid,
            size,
            rng
        );

        grid[candidate.r][candidate.c] = region.id;
        region.size++;
        remaining--;

        /*
         * Update movement direction toward the newly acquired tile.
         */
        region.dirR = candidate.r - region.lastR;
        region.dirC = candidate.c - region.lastC;

        if (region.dirR !== 0) {
            region.dirR = Math.sign(region.dirR);
        }

        if (region.dirC !== 0) {
            region.dirC = Math.sign(region.dirC);
        }

        region.lastR = candidate.r;
        region.lastC = candidate.c;

        updateFrontier(region);
    }

    if (remaining !== 0) {
        return null;
    }

    /*
     * Validate that every region is connected.
     */
    if (!validateRegions(grid, size)) {
        return null;
    }

    return grid;


    // -------------------------------------------------------------------------
    // Region helpers
    // -------------------------------------------------------------------------

    function updateFrontier(region) {
        const seen = new Set();

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (grid[r][c] !== region.id) {
                    continue;
                }

                for (const [dr, dc] of ORTHOGONAL) {
                    const nr = r + dr;
                    const nc = c + dc;

                    if (!inside(size, nr, nc)) {
                        continue;
                    }

                    if (grid[nr][nc] !== -1) {
                        continue;
                    }

                    const key = nr * size + nc;

                    if (!seen.has(key)) {
                        seen.add(key);
                    }
                }
            }
        }

        region.frontier = [...seen].map(key => ({
            r: Math.floor(key / size),
            c: key % size
        }));
    }


    function getFrontierCandidates(region) {
        /*
         * Recalculate instead of relying on stale frontier data.
         * Boards are at most 20x20, so this is cheap.
         */
        const candidates = [];
        const seen = new Set();

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (grid[r][c] !== region.id) {
                    continue;
                }

                for (const [dr, dc] of ORTHOGONAL) {
                    const nr = r + dr;
                    const nc = c + dc;

                    if (!inside(size, nr, nc)) {
                        continue;
                    }

                    if (grid[nr][nc] !== -1) {
                        continue;
                    }

                    const key = nr * size + nc;

                    if (!seen.has(key)) {
                        seen.add(key);
                        candidates.push({ r: nr, c: nc });
                    }
                }
            }
        }

        return candidates;
    }


    function chooseRegion(available, size, rng) {
        const target = size;

        /*
         * Softly prefer small regions.
         * Still leave plenty of randomness.
         */
        let totalWeight = 0;

        const weighted = available.map(region => {
            const difference = target - region.size;

            const weight =
                Math.max(0.15, 1 + difference * 0.18) *
                (0.7 + rng.next() * 0.6);

            totalWeight += weight;

            return { region, weight };
        });

        let roll = rng.next() * totalWeight;

        for (const item of weighted) {
            roll -= item.weight;

            if (roll <= 0) {
                return item.region;
            }
        }

        return available[available.length - 1];
    }


    function chooseExpansion(region, candidates, grid, size, rng) {
        let best = null;
        let bestScore = -Infinity;

        for (const candidate of candidates) {
            const score = expansionScore(
                region,
                candidate,
                grid,
                size,
                rng
            );

            if (score > bestScore) {
                bestScore = score;
                best = candidate;
            }
        }

        return best;
    }


    function expansionScore(region, candidate, grid, size, rng) {
        let score = rng.next() * 8;

        const { r, c } = candidate;

        /*
         * Compactness:
         * Having multiple same-color neighbors keeps the region
         * coherent instead of creating thin disconnected-looking arms.
         */
        let sameNeighbors = 0;

        for (const [dr, dc] of ORTHOGONAL) {
            const nr = r + dr;
            const nc = c + dc;

            if (
                inside(size, nr, nc) &&
                grid[nr][nc] === region.id
            ) {
                sameNeighbors++;
            }
        }

        score += sameNeighbors * 3;

        /*
         * Directional momentum.
         *
         * This is what gives the regions their "squiggle" quality.
         */
        if (region.lastR !== undefined) {
            const dr = Math.sign(r - region.lastR);
            const dc = Math.sign(c - region.lastC);

            if (dr === region.dirR) {
                score += 4;
            }

            if (dc === region.dirC) {
                score += 4;
            }
        }

        /*
         * Penalize touching too many different regions.
         * This tends to produce cleaner boundaries.
         */
        const neighboringRegions = new Set();

        for (const [dr, dc] of ALL_NEIGHBORS) {
            const nr = r + dr;
            const nc = c + dc;

            if (!inside(size, nr, nc)) {
                continue;
            }

            const other = grid[nr][nc];

            if (other !== -1 && other !== region.id) {
                neighboringRegions.add(other);
            }
        }

        score -= neighboringRegions.size * 1.2;

        return score;
    }
}


// -----------------------------------------------------------------------------
// Region validation
// -----------------------------------------------------------------------------

function validateRegions(grid, size) {
    const regionCount = size;

    for (let region = 0; region < regionCount; region++) {
        let start = null;
        let count = 0;

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (grid[r][c] === region) {
                    count++;

                    if (!start) {
                        start = { r, c };
                    }
                }
            }
        }

        if (count === 0 || !start) {
            return false;
        }

        /*
         * Flood fill.
         */
        const visited = make2D(size, false);
        const queue = [start];

        visited[start.r][start.c] = true;

        let reached = 0;

        while (queue.length) {
            const current = queue.shift();

            reached++;

            for (const [dr, dc] of ORTHOGONAL) {
                const nr = current.r + dr;
                const nc = current.c + dc;

                if (!inside(size, nr, nc)) {
                    continue;
                }

                if (visited[nr][nc]) {
                    continue;
                }

                if (grid[nr][nc] !== region) {
                    continue;
                }

                visited[nr][nc] = true;

                queue.push({
                    r: nr,
                    c: nc
                });
            }
        }

        if (reached !== count) {
            return false;
        }
    }

    return true;
}


// -----------------------------------------------------------------------------
// Region refinement
// -----------------------------------------------------------------------------

/*
 * Growing connected regions from the crowns guarantees that the intended
 * crown layout is a solution, but it does not by itself make that solution
 * unique.  In practice the first growth pass is far too permissive: an 8x8
 * board almost always has another valid placement.
 *
 * Move non-crown boundary tiles between neighbouring regions.  A move is
 * retained only if both connectivity and the number of solutions are not made
 * worse.  Since crown tiles are never moved, the intended solution remains
 * valid throughout.
 */
function refineRegionsForUniqueness(grid, crowns, rng, nodeLimit) {
    const size = grid.length;
    let result = countSolutions(grid, 2, nodeLimit);

    if (!result.exhausted || result.count <= 1) {
        return result;
    }

    // Small boards need more shaping; keeping this bounded makes failed
    // attempts cheap and lets the outer generator try a fresh board.
    const mutations = size * size * (size <= 10 ? 50 : 10);

    for (let step = 0; step < mutations && result.count > 1; step++) {
        const r = rng.int(0, size - 1);
        const c = rng.int(0, size - 1);

        if (crowns[r] === c) {
            continue;
        }

        const previousRegion = grid[r][c];
        const neighbourRegions = [];

        for (const [dr, dc] of ORTHOGONAL) {
            const nr = r + dr;
            const nc = c + dc;

            if (!inside(size, nr, nc)) {
                continue;
            }

            const region = grid[nr][nc];

            if (
                region !== previousRegion &&
                !neighbourRegions.includes(region)
            ) {
                neighbourRegions.push(region);
            }
        }

        if (neighbourRegions.length === 0) {
            continue;
        }

        grid[r][c] = rng.pick(neighbourRegions);

        if (!validateRegions(grid, size)) {
            grid[r][c] = previousRegion;
            continue;
        }

        const next = countSolutions(grid, 2, nodeLimit);

        if (next.exhausted && next.count <= result.count) {
            result = next;
        } else {
            grid[r][c] = previousRegion;
        }
    }

    return result;
}


// -----------------------------------------------------------------------------
// Board validation
// -----------------------------------------------------------------------------

function validateBoard(grid, crowns) {
    const size = grid.length;

    if (
        size < 4 ||
        size > 20 ||
        !grid.every(row => row.length === size) ||
        !grid.every(row => row.every(region =>
            Number.isInteger(region) && region >= 0 && region < size
        ))
    ) {
        return false;
    }

    /*
     * One crown per row is inherent in crowns[].
     */

    /*
     * One crown per column.
     */
    const columns = new Set(crowns);

    if (columns.size !== size) {
        return false;
    }

    /*
     * No touching crowns.
     */
    for (let r = 0; r < size; r++) {
        for (let r2 = r + 1; r2 < size; r2++) {
            const c1 = crowns[r];
            const c2 = crowns[r2];

            if (
                Math.abs(r - r2) <= 1 &&
                Math.abs(c1 - c2) <= 1
            ) {
                return false;
            }
        }
    }

    /*
     * Exactly one crown per region.
     */
    const regionHasCrown = new Set();

    for (let r = 0; r < size; r++) {
        const c = crowns[r];
        const region = grid[r][c];

        if (regionHasCrown.has(region)) {
            return false;
        }

        regionHasCrown.add(region);
    }

    if (regionHasCrown.size !== size) {
        return false;
    }

    /*
     * Every region must be connected.
     */
    if (!validateRegions(grid, size)) {
        return false;
    }

    return true;
}


// -----------------------------------------------------------------------------
// Puzzle solver
// -----------------------------------------------------------------------------

/*
 * Count solutions.
 *
 * We only care whether there are:
 *
 *   0 solutions
 *   1 solution
 *   2+ solutions
 *
 * So the search stops at 2.
 *
 * This is much faster than enumerating every solution.
 */

function countSolutions(grid, maxSolutions = 2, nodeLimit = 2_000_000) {
    const size = grid.length;

    const usedColumns = new Array(size).fill(false);
    const usedRegions = new Array(size).fill(false);

    const placement = new Array(size).fill(-1);

    let solutions = 0;
    let nodes = 0;

    /*
     * Precompute region of every cell.
     */
    const regions = grid;

    /*
     * Candidate columns for each row.
     */
    const candidates = [];

    for (let r = 0; r < size; r++) {
        candidates[r] = [];

        for (let c = 0; c < size; c++) {
            candidates[r].push(c);
        }
    }

    /*
     * We solve row-by-row.
     *
     * Because the row itself is the recursion variable,
     * one crown per row is automatic.
     */
    function solve(row) {
        if (solutions >= maxSolutions) {
            return;
        }

        if (nodes++ >= nodeLimit) {
            return;
        }

        if (row === size) {
            solutions++;
            return;
        }

        /*
         * Candidate ordering.
         *
         * Randomness is not needed here; deterministic ordering makes
         * generation reproducible.
         */
        for (const col of candidates[row]) {
            if (usedColumns[col]) {
                continue;
            }

            const region = regions[row][col];

            if (usedRegions[region]) {
                continue;
            }

            /*
             * No adjacent crowns.
             */
            if (row > 0) {
                const previousCol = placement[row - 1];

                if (Math.abs(previousCol - col) <= 1) {
                    continue;
                }
            }

            placement[row] = col;
            usedColumns[col] = true;
            usedRegions[region] = true;

            solve(row + 1);

            usedRegions[region] = false;
            usedColumns[col] = false;
            placement[row] = -1;

            if (solutions >= maxSolutions) {
                return;
            }

            if (nodes >= nodeLimit) {
                return;
            }
        }
    }

    solve(0);

    return {
        count: solutions,
        exhausted: nodes < nodeLimit,
        nodes
    };
}


// -----------------------------------------------------------------------------
// Human-style logic solver
// -----------------------------------------------------------------------------

/*
 * Attempts to solve an unsolved region board without guessing.  It applies:
 *
 *   - forced placements in a row, column, or region;
 *   - normal queen attack elimination; and
 *   - locked region pairs: when two regions can only appear in the same two
 *     rows (or columns), other regions cannot use those rows (or columns).
 *
 * This is deliberately separate from countSolutions(), which is a search
 * solver used to prove uniqueness and is allowed to backtrack.
 */
function solveByLogic(board, options = {}) {
    const grid = board.regions ?? board;
    const size = grid.length;
    const maxSteps = options.maxSteps ?? size * size * 10;

    if (
        !Number.isInteger(size) ||
        size < 4 ||
        !grid.every(row => row.length === size) ||
        !grid.every(row => row.every(cell => {
            const region = typeof cell === "object" ? cell.region : cell;
            return Number.isInteger(region) && region >= 0 && region < size;
        }))
    ) {
        throw new Error("Expected a square region grid with IDs 0 through size - 1.");
    }

    const regions = grid.map(row => row.map(cell =>
        typeof cell === "object" ? cell.region : cell
    ));
    const placements = Array(size).fill(-1);
    const excluded = make2D(size, false);
    const steps = [];

    function candidateState() {
        const usedColumns = new Set();
        const usedRegions = new Set();

        for (let r = 0; r < size; r++) {
            if (placements[r] !== -1) {
                usedColumns.add(placements[r]);
                usedRegions.add(regions[r][placements[r]]);
            }
        }

        const rows = Array.from({ length: size }, () => []);
        const columns = Array.from({ length: size }, () => []);
        const regionCells = Array.from({ length: size }, () => []);

        for (let r = 0; r < size; r++) {
            if (placements[r] !== -1) {
                continue;
            }

            for (let c = 0; c < size; c++) {
                const region = regions[r][c];

                if (excluded[r][c] || usedColumns.has(c) || usedRegions.has(region)) {
                    continue;
                }

                if (
                    (r > 0 && placements[r - 1] !== -1 &&
                        Math.abs(placements[r - 1] - c) <= 1) ||
                    (r + 1 < size && placements[r + 1] !== -1 &&
                        Math.abs(placements[r + 1] - c) <= 1)
                ) {
                    continue;
                }

                const cell = { r, c, region };
                rows[r].push(cell);
                columns[c].push(cell);
                regionCells[region].push(cell);
            }
        }

        return { usedColumns, usedRegions, rows, columns, regionCells };
    }

    function assign(cell, reason) {
        if (placements[cell.r] !== -1 && placements[cell.r] !== cell.c) {
            return false;
        }

        for (let r = 0; r < size; r++) {
            if (r === cell.r || placements[r] === -1) {
                continue;
            }

            if (
                placements[r] === cell.c ||
                regions[r][placements[r]] === cell.region ||
                (Math.abs(r - cell.r) === 1 &&
                    Math.abs(placements[r] - cell.c) <= 1)
            ) {
                return false;
            }
        }

        if (placements[cell.r] === -1) {
            placements[cell.r] = cell.c;
            steps.push({ type: "placement", reason, row: cell.r, column: cell.c, region: cell.region });
        }

        return true;
    }

    function contradiction(state) {
        for (let i = 0; i < size; i++) {
            if (placements[i] === -1 && state.rows[i].length === 0) {
                return `Row ${i + 1} has no possible crown cell.`;
            }

            if (!state.usedColumns.has(i) && state.columns[i].length === 0) {
                return `Column ${i + 1} has no possible crown cell.`;
            }

            if (!state.usedRegions.has(i) && state.regionCells[i].length === 0) {
                return `Region ${i + 1} has no possible crown cell.`;
            }
        }

        return null;
    }

    for (let iteration = 0; iteration < maxSteps; iteration++) {
        const state = candidateState();
        const error = contradiction(state);

        if (error) {
            return { solved: false, status: "contradiction", placements, steps, reason: error };
        }

        if (placements.every(column => column !== -1)) {
            return { solved: true, status: "solved", placements, steps };
        }

        const forced = new Map();
        const addForced = (cell, reason) => {
            const key = `${cell.r},${cell.c}`;
            if (!forced.has(key)) {
                forced.set(key, { cell, reason });
            }
        };

        for (let r = 0; r < size; r++) {
            if (placements[r] === -1 && state.rows[r].length === 1) {
                addForced(state.rows[r][0], "only candidate in row");
            }
        }

        for (let c = 0; c < size; c++) {
            if (!state.usedColumns.has(c) && state.columns[c].length === 1) {
                addForced(state.columns[c][0], "only candidate in column");
            }
        }

        for (let region = 0; region < size; region++) {
            if (!state.usedRegions.has(region) && state.regionCells[region].length === 1) {
                addForced(state.regionCells[region][0], "only candidate in region");
            }
        }

        if (forced.size > 0) {
            for (const { cell, reason } of forced.values()) {
                if (!assign(cell, reason)) {
                    return { solved: false, status: "contradiction", placements, steps, reason: "Conflicting forced placements." };
                }
            }

            continue;
        }

        let eliminated = false;

        /* Locked pairs of regions in two rows/columns. */
        for (const axis of ["row", "column"]) {
            for (let a = 0; a < size; a++) {
                if (state.usedRegions.has(a)) {
                    continue;
                }

                for (let b = a + 1; b < size; b++) {
                    if (state.usedRegions.has(b)) {
                        continue;
                    }

                    const positions = new Set(
                        [...state.regionCells[a], ...state.regionCells[b]]
                            .map(cell => axis === "row" ? cell.r : cell.c)
                    );

                    if (positions.size !== 2) {
                        continue;
                    }

                    for (const position of positions) {
                        const cells = axis === "row"
                            ? state.rows[position]
                            : state.columns[position];

                        for (const cell of cells) {
                            if (
                                cell.region !== a &&
                                cell.region !== b &&
                                !excluded[cell.r][cell.c]
                            ) {
                                excluded[cell.r][cell.c] = true;
                                eliminated = true;
                            }
                        }
                    }

                    if (eliminated) {
                        steps.push({
                            type: "elimination",
                            regions: [a, b],
                            axis
                        });
                    }
                }
            }
        }

        if (!eliminated) {
            return { solved: false, status: "stalled", placements, steps, reason: "No further rule-based deductions are available." };
        }
    }

    return { solved: false, status: "stalled", placements, steps, reason: "Logic step limit reached." };
}


function validateLogicalSolvability(board, options = {}) {
    const result = solveByLogic(board, options);

    return {
        valid: result.solved,
        ...result
    };
}


// -----------------------------------------------------------------------------
// Difficulty
// -----------------------------------------------------------------------------

function calculateDifficulty(grid) {
    const size = grid.length;

    /*
     * Number of cells per region.
     */
    const sizes = Array(size).fill(0);

    for (const row of grid) {
        for (const region of row) {
            sizes[region]++;
        }
    }

    const average = size;
    const variance =
        sizes.reduce(
            (sum, x) => sum + Math.pow(x - average, 2),
            0
        ) / size;

    /*
     * Count boundaries.
     */
    let boundaries = 0;

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (r + 1 < size && grid[r][c] !== grid[r + 1][c]) {
                boundaries++;
            }

            if (c + 1 < size && grid[r][c] !== grid[r][c + 1]) {
                boundaries++;
            }
        }
    }

    /*
     * This isn't a mathematically exact "difficulty".
     * It is a useful generation metric.
     */
    const boundaryScore =
        boundaries / (size * size * 2);

    const balanceScore =
        Math.min(1, variance / (size * size));

    return Math.round(
        (
            /* Leave room for region complexity even on a 20x20 board. */
            size * 3 +
            boundaryScore * 50 +
            balanceScore * 30
        ) * 10
    ) / 10;
}


// -----------------------------------------------------------------------------
// Convert to rendering-friendly grid
// -----------------------------------------------------------------------------

function makeRenderGrid(regionGrid, crowns) {
    const size = regionGrid.length;

    return regionGrid.map((row, r) =>
        row.map((region, c) => ({
            region,
            crown: crowns[r] === c
        }))
    );
}


// -----------------------------------------------------------------------------
// Main generator
// -----------------------------------------------------------------------------

/*
 * Large boards are composed from unique small boards placed on the diagonal.
 * Their off-diagonal cells are then grown from those components so the board
 * remains a complete connected-region map.
 */
function generateCompositeLevel(size, seed, options) {
    const componentSizes = [];
    let remaining = size;

    while (remaining > 0) {
        const componentSize = Math.min(8, remaining - 4);
        const usableSize = componentSize >= 4
            ? componentSize
            : remaining;

        componentSizes.push(usableSize);
        remaining -= usableSize;
    }

    const regions = make2D(size, -1);
    const crowns = [];
    let offset = 0;
    let regionOffset = 0;
    let previousCrown = null;

    for (let index = 0; index < componentSizes.length; index++) {
        const componentSize = componentSizes[index];
        const componentSeed =
            (Number(seed) + Math.imul(index + 1, 0x9E3779B9)) >>> 0;
        const component = generateLevel(componentSize, componentSeed, {
            ...options,
            requireUnique: true
        });

        let componentRegions = component.regions;
        let componentCrowns = component.crowns;

        /*
         * Avoid diagonal contact across neighbouring component boundaries.
         * Horizontal reflection preserves connectivity and uniqueness.
         */
        if (
            previousCrown !== null &&
            Math.abs(previousCrown - (offset + componentCrowns[0])) <= 1
        ) {
            componentRegions = componentRegions.map(row =>
                [...row].reverse()
            );
            componentCrowns = componentCrowns.map(
                column => componentSize - 1 - column
            );
        }

        for (let r = 0; r < componentSize; r++) {
            crowns[offset + r] = offset + componentCrowns[r];

            for (let c = 0; c < componentSize; c++) {
                regions[offset + r][offset + c] =
                    regionOffset + componentRegions[r][c];
            }
        }

        previousCrown = crowns[offset + componentSize - 1];
        offset += componentSize;
        regionOffset += componentSize;
    }

    /*
     * The diagonal components do not cover the off-diagonal cells.  Grow
     * their existing regions into that space; every assigned cell touches a
     * region it joins, so connectivity is retained.
     */
    const regionSizes = Array(size).fill(0);
    let unassigned = 0;

    for (const row of regions) {
        for (const region of row) {
            if (region === -1) {
                unassigned++;
            } else {
                regionSizes[region]++;
            }
        }
    }

    while (unassigned > 0) {
        const assignments = [];

        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (regions[r][c] !== -1) {
                    continue;
                }

                let chosenRegion = -1;

                for (const [dr, dc] of ORTHOGONAL) {
                    const nr = r + dr;
                    const nc = c + dc;

                    if (!inside(size, nr, nc) || regions[nr][nc] === -1) {
                        continue;
                    }

                    const candidate = regions[nr][nc];

                    if (
                        chosenRegion === -1 ||
                        regionSizes[candidate] < regionSizes[chosenRegion]
                    ) {
                        chosenRegion = candidate;
                    }
                }

                if (chosenRegion !== -1) {
                    assignments.push({ r, c, region: chosenRegion });
                }
            }
        }

        if (assignments.length === 0) {
            throw new Error("Could not assign every composite region cell.");
        }

        for (const assignment of assignments) {
            regions[assignment.r][assignment.c] = assignment.region;
            regionSizes[assignment.region]++;
            unassigned--;
        }
    }

    if (!validateBoard(regions, crowns)) {
        throw new Error(`Could not compose a valid ${size}x${size} level.`);
    }

    return {
        size,
        grid: makeRenderGrid(regions, crowns),
        crowns,
        regions,
        regionSizes,
        difficulty: calculateDifficulty(regions),
        seed,
        attempt: 1,
        // The component proof no longer applies once regions are expanded
        // into the off-diagonal cells, so this board is not claimed unique.
        unique: null,
        solver: null
    };
}

function generateLevel(size = 8, seed = Date.now(), options = {}) {
    if (!Number.isInteger(size) || size < 4 || size > 20) {
        throw new Error("Board size must be an integer between 4 and 20.");
    }

    if (size > 8) {
        const maxAttempts = options.maxAttempts ?? 500;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const attemptSeed =
                (Number(seed) + Math.imul(attempt, 0x9E3779B9)) >>> 0;
            const level = generateCompositeLevel(size, attemptSeed, options);
            const logic = validateLogicalSolvability(level.regions);

            if (level.difficulty <= 100 && logic.valid) {
                return {
                    ...level,
                    seed,
                    attempt: attempt + 1,
                    logic
                };
            }
        }

        throw new Error(
            `Could not generate a ${size}x${size} level that is at most ` +
            `difficulty 100 and solvable by logic after ${maxAttempts} attempts.`
        );
    }

    const {
        requireUnique = size <= 8,

        /*
         * Number of completely different attempts.
         */
        maxAttempts = 500,

        /*
         * Solver node limit.
         *
         * If exceeded, that board is rejected when uniqueness
         * is required.
         */
        solverNodeLimit = 2_000_000
    } = options;

    const rng = new RNG(seed);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        /*
         * -------------------------------------------------------------
         * 1. Generate crowns.
         * -------------------------------------------------------------
         */
        let crowns;

        try {
            crowns = generateCrowns(size, rng);
        } catch {
            continue;
        }

        /*
         * -------------------------------------------------------------
         * 2. Generate connected colored regions.
         * -------------------------------------------------------------
         */
        const regionGrid = generateRegions(
            size,
            crowns,
            rng
        );

        if (!regionGrid) {
            continue;
        }

        /*
         * -------------------------------------------------------------
         * 3. Validate all generation rules.
         * -------------------------------------------------------------
         */
        if (!validateBoard(regionGrid, crowns)) {
            continue;
        }

        /*
         * Difficulty is a generation constraint, not merely a value to
         * display. Try another crown/region layout when it is too difficult.
         */
        const difficulty = calculateDifficulty(regionGrid);

        if (difficulty > 100) {
            continue;
        }

        /*
         * 4. Shape region boundaries to rule out alternate solutions.
         */
        let solverResult = null;

        if (requireUnique) {
            solverResult = refineRegionsForUniqueness(
                regionGrid,
                crowns,
                rng,
                solverNodeLimit
            );

            if (!solverResult.exhausted || solverResult.count !== 1) {
                continue;
            }
        }

        /*
         * -------------------------------------------------------------
         * 5. Confirm puzzle uniqueness.
         * -------------------------------------------------------------
         *
         * The generated crowns themselves are guaranteed to be
         * a solution because each crown started one region.
         *
         * We now check whether there is any OTHER solution.
         */
        if (requireUnique) {
            solverResult = countSolutions(
                regionGrid,
                2,
                solverNodeLimit
            );

            /*
             * We don't accept an unfinished search as proof of
             * uniqueness.
             */
            if (!solverResult.exhausted) {
                continue;
            }

            if (solverResult.count !== 1) {
                continue;
            }
        }

        /*
         * 6. A generated puzzle must be completable by the rule-based
         * human solver. Boards that need guessing are discarded.
         */
        const logic = validateLogicalSolvability(regionGrid);

        if (!logic.valid) {
            continue;
        }

        /*
         * -------------------------------------------------------------
         * 5. Produce rendering-friendly result.
         * -------------------------------------------------------------
         */
        const grid = makeRenderGrid(
            regionGrid,
            crowns
        );

        const regionSizes = Array(size).fill(0);

        for (const row of regionGrid) {
            for (const region of row) {
                regionSizes[region]++;
            }
        }

        return {
            size,

            /*
             * The thing you probably want to give directly
             * to your renderer.
             */
            grid,

            /*
             * Crown position per row.
             *
             * crowns[r] = column
             */
            crowns,

            /*
             * Raw region IDs.
             *
             * This can be useful if your renderer wants to
             * preprocess the board.
             */
            regions: regionGrid,

            /*
             * Useful metadata.
             */
            regionSizes,

            difficulty,

            seed,
            attempt: attempt + 1,

            unique: requireUnique
                ? solverResult.count === 1
                : null,

            solver: solverResult,
            logic
        };
    }

    throw new Error(
        `Could not generate a valid ${size}x${size} level ` +
        `after ${maxAttempts} attempts.`
    );
}


// -----------------------------------------------------------------------------
// Convenience helpers
// -----------------------------------------------------------------------------

function generateRandomLevel(size = 8, options = {}) {
    const seed =
        Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;

    return generateLevel(size, seed, options);
}

function printLevel(
    level,
    { useColors = true, showSolution = false } = {}
) {
    const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const isBrowserConsole =
        typeof window !== "undefined" &&
        typeof document !== "undefined";

    /*
     * Dark xterm background colours keep the white region label legible.
     * The browser version uses the same region ID to derive an HSL colour.
     */
    const terminalBackgrounds = [
        17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
        52, 53, 54, 55, 56, 57, 58, 59, 60, 61
    ];

    function tile(cell) {
        const label = labels[cell.region % labels.length];

        if (showSolution) {
            return cell.crown ? `[${label}]` : ` - `
        }

        return ` ${label} `
    }

    function browserStyle(region, crown) {
        const hue = (region * 137.508) % 360;

        return [
            `background: hsl(${hue} 62% 36%)`,
            "color: white",
            showSolution && crown ? "font-weight: 800" : "font-weight: 400",
            "font-family: monospace",
            "padding: 2px 0"
        ].join("; ");
    }

    function terminalTile(cell) {
        if (!useColors) {
            return tile(cell);
        }

        const background = terminalBackgrounds[
            cell.region % terminalBackgrounds.length
        ];
        const emphasis = showSolution && cell.crown ? "\x1b[1m" : "";

        return `\x1b[48;5;${background}m\x1b[97m${emphasis}` +
            `${tile(cell)}\x1b[0m`;
    }

    console.log("");

    for (const row of level.grid) {
        if (useColors && isBrowserConsole) {
            console.log(
                row.map(() => "%c%s").join(""),
                ...row.flatMap(cell => [
                    browserStyle(cell.region, cell.crown),
                    tile(cell)
                ])
            );
        } else {
            console.log(row.map(terminalTile).join(""));
        }
    }

    console.log("");

    if (!showSolution) {
        console.log(`Size:       ${level.size}x${level.size}`);
        console.log(`Seed:       ${level.seed}`);
        console.log(`Difficulty: ${level.difficulty}`);
        console.log(`Unique:     ${level.unique}`);
        console.log(`Attempts:   ${level.attempt}`);
    }
}

function printLevelSolution(level, options = {}) {
    printLevel(level, { ...options, showSolution: true });

    const result = validateLogicalSolvability(level.regions);
    console.log(`Deductions made: `, result.steps);
}


// -----------------------------------------------------------------------------
// Browser game
// -----------------------------------------------------------------------------

const CURRENT_LEVEL_STORAGE_KEY = "crowns.currentLevel";
const ROYAL_MODE_STORAGE_KEY = "crowns.royalMode";
const RAINBOW_MODE_STORAGE_KEY = "crowns.rainbowMode";

function getStoredLevel() {
    const storedLevel = Number.parseInt(
        window.localStorage.getItem(CURRENT_LEVEL_STORAGE_KEY),
        10
    );

    return Number.isInteger(storedLevel) && storedLevel >= 1
        ? storedLevel
        : 1;
}

function saveCurrentLevel(levelNumber) {
    window.localStorage.setItem(
        CURRENT_LEVEL_STORAGE_KEY,
        String(levelNumber)
    );
}

function isRoyalModeEnabled() {
    return window.localStorage.getItem(ROYAL_MODE_STORAGE_KEY) === "true";
}

function isRainbowModeEnabled() {
    return window.localStorage.getItem(RAINBOW_MODE_STORAGE_KEY) === "true";
}

function toggleRainbowMode() {
    const rainbowModeEnabled = !isRainbowModeEnabled();

    window.localStorage.setItem(
        RAINBOW_MODE_STORAGE_KEY,
        String(rainbowModeEnabled)
    );
    document.body.classList.toggle("rainbow-mode", rainbowModeEnabled);

    const titleElement = document.querySelector("#level-title");
    titleElement.textContent = rainbowModeEnabled
        ? "Rainbow Kingdom 🌈"
        : "Rainbow Mode Disabled";
    window.setTimeout(() => {
        titleElement.textContent = `Level ${getStoredLevel()}`;
    }, 1800);
}

function toggleRoyalMode() {
    const royalModeEnabled = !isRoyalModeEnabled();

    window.localStorage.setItem(
        ROYAL_MODE_STORAGE_KEY,
        String(royalModeEnabled)
    );
    document.body.classList.toggle("royal-mode", royalModeEnabled);

    const titleElement = document.querySelector("#level-title");
    titleElement.textContent = royalModeEnabled
        ? "Royal Mode Unlocked 👑"
        : "Royal Mode Disabled";
    window.setTimeout(() => {
        titleElement.textContent = `Level ${getStoredLevel()}`;
    }, 1800);
}

function createRoyalParticle(x, y) {
    const particle = document.createElement("span");
    particle.className = "royal-particle";
    particle.textContent = "⭐";
    particle.style.left = `${x + (Math.random() - 0.5) * 40}px`;
    particle.style.top = `${y}px`;
    particle.style.setProperty(
        "--royal-drift",
        `${-80 + Math.random() * 160}px`
    );
    particle.style.setProperty(
        "--royal-rise",
        `${-140 + Math.random() * 280}px`
    );
    particle.style.setProperty(
        "--royal-duration",
        `${900 + Math.random() * 600}ms`
    );

    particle.addEventListener("animationend", () => {
        particle.remove();
    }, { once: true });

    document.body.appendChild(particle);
}

function createRainbowParticle(x, y) {
    const particle = document.createElement("span");
    particle.className = "rainbow-particle";
    particle.textContent = "✨";
    particle.style.left = `${x}px`;
    particle.style.top = `${y}px`;
    particle.style.setProperty(
        "--rainbow-drift",
        `${-140 + Math.random() * 280}px`
    );
    particle.style.setProperty(
        "--rainbow-rise",
        `${-140 + Math.random() * 280}px`
    );
    particle.style.setProperty(
        "--rainbow-hue",
        `${Math.floor(Math.random() * 360)}deg`
    );
    particle.style.setProperty(
        "--rainbow-duration",
        `${700 + Math.random() * 800}ms`
    );

    particle.addEventListener("animationend", () => {
        particle.remove();
    }, { once: true });

    document.body.appendChild(particle);
}

function isBoardCircleGesture(points, boardElement) {
    if (points.length < 12) {
        return false;
    }

    const bounds = boardElement.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const radiusX = Math.max(bounds.width / 2, 1);
    const radiusY = Math.max(bounds.height / 2, 1);
    let totalAngle = 0;
    let previousAngle = null;
    const radii = [];

    for (const point of points) {
        const normalizedX = (point.x - centerX) / radiusX;
        const normalizedY = (point.y - centerY) / radiusY;
        const radius = Math.hypot(normalizedX, normalizedY);
        const angle = Math.atan2(normalizedY, normalizedX);

        radii.push(radius);

        if (previousAngle !== null) {
            let delta = angle - previousAngle;

            if (delta > Math.PI) {
                delta -= Math.PI * 2;
            } else if (delta < -Math.PI) {
                delta += Math.PI * 2;
            }

            totalAngle += delta;
        }

        previousAngle = angle;
    }

    const averageRadius =
        radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
    const radiusVariation =
        Math.max(...radii) - Math.min(...radii);

    return (
        Math.abs(totalAngle) >= Math.PI * 1.6 &&
        averageRadius >= 0.65 &&
        averageRadius <= 1.5 &&
        radiusVariation <= 0.9
    );
}

function highlightBoardEdges(boardElement, size) {
    const edgeCells = boardElement.querySelectorAll(".cell");

    edgeCells.forEach(cell => {
        const row = Number(cell.dataset.row);
        const column = Number(cell.dataset.column);

        if (
            row === 0 ||
            column === 0 ||
            row === size - 1 ||
            column === size - 1
        ) {
            cell.classList.add("rainbow-edge-highlight");
        }
    });

    window.setTimeout(() => {
        edgeCells.forEach(cell => {
            cell.classList.remove("rainbow-edge-highlight");
        });
    }, 1400);
}

function getBoardSize(levelNumber) {
    const interpolate = (startLevel, endLevel, startSize, endSize) =>
        Math.round(
            startSize +
            ((levelNumber - startLevel) / (endLevel - startLevel)) *
            (endSize - startSize)
        );

    if (levelNumber <= 5) {
        return 4;
    }

    if (levelNumber <= 100) {
        return interpolate(6, 100, 5, 7);
    }

    if (levelNumber <= 200) {
        return interpolate(101, 200, 7, 9);
    }

    if (levelNumber <= 500) {
        return interpolate(201, 500, 9, 11);
    }

    if (levelNumber <= 1000) {
        return interpolate(501, 1000, 11, 14);
    }

    return 15
}

function getLevelSeed(levelNumber) {
    // A stable integer hash makes the same level produce the same board for
    // every player, without relying on the current time or random state.
    let hash = 0x811c9dc5;
    const value = String(levelNumber);

    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }

    return hash >>> 0;
}

function isSolved(level, cellStates) {
    const crownsArePlaced = level.crowns.every(
        (columnIndex, rowIndex) =>
            cellStates[rowIndex][columnIndex] === "crowned"
    );

    const crownsAreCorrect = cellStates.every((row, rowIndex) =>
        row.every((state, columnIndex) =>
            state !== "crowned" ||
            level.crowns[rowIndex] === columnIndex
        )
    );

    return crownsArePlaced && crownsAreCorrect;
}

function renderLevel(level, levelNumber, onSolved) {
    const boardElement = document.querySelector(".board");
    const titleElement = document.querySelector("#level-title");
    const cellStates = level.grid.map(row => row.map(() => null));
    const doubleTapDelay = 300;
    let lastTap = null;
    let gesturePoints = [];

    titleElement.textContent = `Level ${levelNumber}`;
    boardElement.innerHTML = "";
    boardElement.style.setProperty(
        "--board-size",
        String(level.size)
    );
    window.requestAnimationFrame(() => {
        boardElement.classList.remove("board--loading");
    });

    function setCellState(cellElement, rowIndex, columnIndex, state) {
        cellStates[rowIndex][columnIndex] = state;
        cellElement.classList.toggle(
            "cell--eliminated",
            state === "eliminated"
        );
        cellElement.classList.toggle(
            "cell--crowned",
            state === "crowned"
        );

        if (
            (isRoyalModeEnabled() || isRainbowModeEnabled()) &&
            state === "crowned"
        ) {
            const bounds = cellElement.getBoundingClientRect();
            const particleCount = 10;

            for (let index = 0; index < particleCount; index++) {
                const x = bounds.left + bounds.width / 2;
                const y = bounds.top + bounds.height / 2;

                if (isRainbowModeEnabled()) {
                    createRainbowParticle(x, y);
                } else {
                    createRoyalParticle(x, y);
                }
            }
        }

        if (isSolved(level, cellStates)) {
            onSolved();
            return;
        }

        const crownCount = cellStates.flat().filter(
            cellState => cellState === "crowned"
        ).length;

        if (state === "crowned" && crownCount >= level.size) {
            boardElement.classList.remove("board--shake");
            void boardElement.offsetWidth;
            boardElement.classList.add("board--shake");
        }
    }

    function applyEliminationMode(
        rowIndex,
        columnIndex,
        mode,
        visitedCells
    ) {
        const cellKey = `${rowIndex}:${columnIndex}`;

        if (visitedCells?.has(cellKey)) {
            return;
        }

        visitedCells?.add(cellKey);

        if (cellStates[rowIndex][columnIndex] === "crowned") {
            return;
        }

        const cellElement = boardElement.querySelector(
            `[data-row="${rowIndex}"][data-column="${columnIndex}"]`
        );

        if (cellElement) {
            setCellState(
                cellElement,
                rowIndex,
                columnIndex,
                mode === "eliminate" ? "eliminated" : null
            );
        }
    }

    level.grid.forEach((row, rowIndex) => {
        const rowElement = document.createElement("div");
        rowElement.classList.add("row");

        row.forEach((cell, columnIndex) => {
            const cellElement = document.createElement("div");
            cellElement.classList.add("cell", `cell-${cell.region}`);
            cellElement.dataset.row = String(rowIndex);
            cellElement.dataset.column = String(columnIndex);
            cellElement.setAttribute(
                "aria-label",
                `Row ${rowIndex + 1}, column ${columnIndex + 1}`
            );

            let activePointerId = null;
            let dragStarted = false;
            let startX = 0;
            let startY = 0;
            let visitedCells = new Set();
            let eliminationMode = "eliminate";

            cellElement.addEventListener("pointerdown", event => {
                event.preventDefault();
                activePointerId = event.pointerId;
                dragStarted = false;
                startX = event.clientX;
                startY = event.clientY;
                visitedCells = new Set();
                gesturePoints = [{
                    x: event.clientX,
                    y: event.clientY
                }];
                eliminationMode =
                    cellStates[rowIndex][columnIndex] === "eliminated"
                        ? "restore"
                        : "eliminate";
                cellElement.setPointerCapture(event.pointerId);
                applyEliminationMode(
                    rowIndex,
                    columnIndex,
                    eliminationMode,
                    visitedCells
                );
            });

            cellElement.addEventListener("pointermove", event => {
                if (event.pointerId !== activePointerId) {
                    return;
                }

                const distance = Math.hypot(
                    event.clientX - startX,
                    event.clientY - startY
                );

                if (distance > 8) {
                    dragStarted = true;
                }

                if (!dragStarted) {
                    return;
                }

                gesturePoints.push({
                    x: event.clientX,
                    y: event.clientY
                });

                const target = document.elementFromPoint(
                    event.clientX,
                    event.clientY
                )?.closest(".cell");

                if (target && boardElement.contains(target)) {
                    applyEliminationMode(
                        Number(target.dataset.row),
                        Number(target.dataset.column),
                        eliminationMode,
                        visitedCells
                    );
                }
            });

            cellElement.addEventListener("pointerup", event => {
                if (event.pointerId !== activePointerId) {
                    return;
                }

                const now = Date.now();
                const isDoubleTap =
                    !dragStarted &&
                    lastTap &&
                    lastTap.rowIndex === rowIndex &&
                    lastTap.columnIndex === columnIndex &&
                    now - lastTap.time <= doubleTapDelay;

                if (isDoubleTap) {
                    setCellState(
                        cellElement,
                        rowIndex,
                        columnIndex,
                        "crowned"
                    );
                    lastTap = null;
                } else if (!dragStarted) {
                    if (cellStates[rowIndex][columnIndex] === "crowned") {
                        setCellState(
                            cellElement,
                            rowIndex,
                            columnIndex,
                            "eliminated"
                        );
                    }

                    lastTap = {
                        rowIndex,
                        columnIndex,
                        time: now
                    };
                } else {
                    if (isBoardCircleGesture(gesturePoints, boardElement)) {
                        toggleRainbowMode();
                        highlightBoardEdges(boardElement, level.size);
                    }

                    lastTap = null;
                }

                activePointerId = null;
                gesturePoints = [];
                cellElement.releasePointerCapture(event.pointerId);
            });

            cellElement.addEventListener("pointercancel", event => {
                if (event.pointerId === activePointerId) {
                    activePointerId = null;
                    lastTap = null;
                    gesturePoints = [];
                }
            });

            rowElement.appendChild(cellElement);
        });

        boardElement.appendChild(rowElement);
    });
}

function startGame() {
    let levelNumber = getStoredLevel();
    let isAdvancing = false;

    function renderCurrentLevel() {
        const level = generateLevel(
            getBoardSize(levelNumber),
            getLevelSeed(levelNumber)
        );

        renderLevel(level, levelNumber, () => {
            if (isAdvancing) {
                return;
            }

            isAdvancing = true;
            const boardElement = document.querySelector(".board");
            // const titleElement = document.querySelector("#level-title");

            boardElement.classList.add("board--loading");
            // titleElement.textContent = "Loading next level...";

            window.setTimeout(() => {
                levelNumber++;
                saveCurrentLevel(levelNumber);
                isAdvancing = false;
                renderCurrentLevel();
            }, 350);
        });
    }

    renderCurrentLevel();
}

function startHeartParticles() {
    const copyrightElement = document.querySelector(".copyright");
    let tapCount = 0;
    let lastTapTime = 0;

    copyrightElement.addEventListener("click", event => {
        const now = Date.now();

        tapCount = now - lastTapTime <= 700 ? tapCount + 1 : 1;
        lastTapTime = now;

        if (tapCount >= 9) {
            toggleRoyalMode();
            tapCount = 0;
        }

        const particleCount = 8;

        for (let index = 0; index < particleCount; index++) {
            const duration = 1000 + Math.random() * 1000;
            const particle = document.createElement("span");

            particle.className = "heart-particle";
            particle.textContent = "💕";
            particle.style.left = `${event.clientX + (Math.random() - 0.5) * 50}px`;
            particle.style.top = `${event.clientY + (Math.random() - 0.5) * 8}px`;
            particle.style.setProperty(
                "--heart-drift",
                `${-100 + Math.random() * 200}px`
            );
            particle.style.setProperty(
                "--heart-rise",
                `${100 + Math.random() * 140}px`
            );
            particle.style.setProperty(
                "--heart-size",
                `${12 + Math.random() * 10}px`
            );
            particle.style.setProperty(
                "--heart-duration",
                `${duration}ms`
            );
            particle.style.setProperty(
                "--heart-rotation",
                `${-35 + Math.random() * 70}deg`
            );

            particle.addEventListener("animationend", () => {
                particle.remove();
            }, { once: true });

            document.body.appendChild(particle);
        }
    });
}

function disableDoubleTapZoom() {
    let lastTouchEnd = 0;

    document.addEventListener("touchend", event => {
        const now = Date.now();

        if (now - lastTouchEnd <= 350) {
            event.preventDefault();
        }

        lastTouchEnd = now;
    }, { passive: false });
}


// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        generateLevel,
        generateRandomLevel,
        countSolutions,
        solveByLogic,
        validateLogicalSolvability,
        validateBoard,
        printLevel,
        printLevelSolution,
        getBoardSize,
        getLevelSeed,
        isSolved
    };
}


// -----------------------------------------------------------------------------
// Start browser game
// -----------------------------------------------------------------------------

if (typeof window !== "undefined" && typeof document !== "undefined") {
    disableDoubleTapZoom();
    if (isRoyalModeEnabled()) {
        document.body.classList.add("royal-mode");
    }
    if (isRainbowModeEnabled()) {
        document.body.classList.add("rainbow-mode");
    }
    startHeartParticles();
    startGame();
}
